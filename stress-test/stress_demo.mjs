#!/usr/bin/env node
/**
 * Privacy Toolkit — Demo 情境壓力測試（N 組使用者同時操作）
 * ---------------------------------------------------------------------------
 * 模擬 Demo 當天多位使用者「同時」在 Step4 按下執行時，瀏覽器實際會送出的 API 序列
 * （與 src/features/step4_result/pipeline/*.ts 完全相同的呼叫順序與 multipart 欄位）：
 *
 *   K-匿名使用者：載入頁面 → POST /api/v1/k-anonymity
 *                → POST /api/v1/risk/k-anonymity（敏感欄位「疾病」1 輪）
 *                → POST /api/v1/risk/cap（1 輪）→ POST /api/v1/report（PDF）
 *   差分隱私使用者：載入頁面 → POST /api/v1/dp
 *                → POST /api/v1/risk/dp（類別型欄位「地區」「職業」各 1 輪，共 2 輪）
 *                → POST /api/v1/risk/cap（2 輪）→ POST /api/v1/report（PDF）
 *
 * 只用 Node 內建模組（不需 npm install）；用 node:http 而非 fetch，避免 fetch 預設
 * 300 秒 headers 逾時把長時間的風險評估誤判為失敗。
 *
 * 用法（在 Demo 專案根目錄）：
 *   node stress-test/stress_demo.mjs                      # 預設：http://localhost:5173，2 K匿名 + 2 DP，5000 筆
 *   node stress-test/stress_demo.mjs --base https://xxx.trycloudflare.com   # 走 cloudflared 通道（最接近 Demo）
 *   node stress-test/stress_demo.mjs --csv D:\data\demo.csv --rows 0        # 改用 Demo 要用的真實資料
 *   node stress-test/stress_demo.mjs --users kanon,kanon,dp,dp --stagger 3000 --no-baseline
 *   node stress-test/stress_demo.mjs --user someone@x.com --password '...'   # 換測試帳號
 * ★ 2026-10-30：處理端點須登入，預設以 Demo 帳號 owner@test.com 登入（可用 --user／--password
 *   或環境變數 STRESS_USER／STRESS_PASSWORD 指定），access token 每 10 分鐘重新取得一次。
 * 參數說明見 README.md 或 --help。
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { generateDemoCsv } from './gen_demo_data.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 參數
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
    base: 'http://localhost:5173',
    users: 'kanon,kanon,dp,dp',
    rows: 5000,
    csv: '',
    stagger: 0,          // 每位使用者之間的啟動間隔（毫秒），0 = 同一瞬間按下執行
    repeat: 1,           // 併發測試重複幾回合
    baseline: true,      // 先各跑 1 位 K匿名 / 1 位 DP 單人基準，用來算「同時使用慢了幾倍」
    report: true,        // 是否呼叫 /api/v1/report 產 PDF
    pageLoad: true,      // 是否模擬瀏覽器載入首頁與 JS/CSS
    timeoutSec: 900,     // 單一請求逾時（與前端 DEFAULT_API_TIMEOUT_MS 15 分鐘一致）
    maxSec: 300,         // 判定 PASS 的單人完整流程上限秒數（Demo 現場可接受的等待時間）
    docker: true,        // 嘗試以 docker stats 監看後端容器 CPU／記憶體
    user: process.env.STRESS_USER || 'owner@test.com',
    password: process.env.STRESS_PASSWORD || 'Owner@123456',
    out: path.join(SCRIPT_DIR, 'results'),
};

const parseArgs = (argv) => {
    const opts = { ...DEFAULTS };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        switch (a) {
            case '--base': opts.base = next().replace(/\/+$/, ''); break;
            case '--users': opts.users = next(); break;
            case '--rows': opts.rows = Number(next()); break;
            case '--csv': opts.csv = next(); break;
            case '--stagger': opts.stagger = Number(next()); break;
            case '--repeat': opts.repeat = Number(next()); break;
            case '--timeout': opts.timeoutSec = Number(next()); break;
            case '--max-sec': opts.maxSec = Number(next()); break;
            case '--out': opts.out = next(); break;
            case '--user': opts.user = next(); break;
            case '--password': opts.password = next(); break;
            case '--no-baseline': opts.baseline = false; break;
            case '--no-report': opts.report = false; break;
            case '--no-page-load': opts.pageLoad = false; break;
            case '--no-docker': opts.docker = false; break;
            case '-h': case '--help':
                console.log(fs.readFileSync(path.join(SCRIPT_DIR, 'README.md'), 'utf8'));
                process.exit(0);
                break;
            default:
                console.error(`未知參數：${a}（--help 查看說明）`);
                process.exit(2);
        }
    }
    opts.userModes = opts.users.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const bad = opts.userModes.filter((m) => m !== 'kanon' && m !== 'dp');
    if (bad.length) { console.error(`--users 只接受 kanon / dp，收到：${bad.join(',')}`); process.exit(2); }
    return opts;
};

// ─────────────────────────────────────────────────────────────────────────────
// HTTP 工具（multipart 自行組裝）
// ─────────────────────────────────────────────────────────────────────────────
const keepAliveHttp = new http.Agent({ keepAlive: true, maxSockets: 64 });
const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 64 });

const buildMultipart = (parts) => {
    const boundary = '----PrivacyStress' + Math.random().toString(16).slice(2);
    const chunks = [];
    for (const p of parts) {
        if (p.filename !== undefined) {
            chunks.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${encodeURIComponent(p.filename)}"\r\n` +
                `Content-Type: ${p.contentType || 'application/octet-stream'}\r\n\r\n`));
            chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(String(p.data), 'utf8'));
            chunks.push(Buffer.from('\r\n'));
        } else {
            chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`));
        }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
};

/** 送出請求；不論成功或失敗都回傳 { status, headers, body, ms, error } 不丟例外 */
const rawRequest = (opts, method, urlPath, { body, contentType, accept, authorization } = {}) => new Promise((resolve) => {
    const url = new URL(opts.base + urlPath);
    const lib = url.protocol === 'https:' ? https : http;
    const started = performance.now();
    const headers = { 'User-Agent': 'privacy-stress-test/1.0', Accept: accept || '*/*' };
    if (body) { headers['Content-Type'] = contentType; headers['Content-Length'] = body.length; }
    if (authorization) headers.Authorization = authorization;
    const req = lib.request(url, {
        method, headers,
        agent: url.protocol === 'https:' ? keepAliveHttps : keepAliveHttp,
        timeout: opts.timeoutSec * 1000,
    }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
            status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks),
            ms: performance.now() - started, error: null,
        }));
        res.on('error', (e) => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0), ms: performance.now() - started, error: e.message }));
    });
    req.on('timeout', () => req.destroy(new Error(`逾時（>${opts.timeoutSec}s）`)));
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), ms: performance.now() - started, error: `${e.code || ''} ${e.message}`.trim() }));
    if (body) req.write(body);
    req.end();
});

// ★ 2026-10-30：處理端點須登入。access token 15 分鐘到期，提前於 10 分鐘重新登入；同時多位使用者共用同一次登入
const TOKEN_REFRESH_MS = 10 * 60 * 1000;
let authState = { token: '', at: 0, pending: null };
const ensureAuth = async (opts) => {
    if (authState.token && performance.now() - authState.at < TOKEN_REFRESH_MS) return authState.token;
    if (!authState.pending) {
        authState.pending = (async () => {
            const body = Buffer.from(JSON.stringify({ username: opts.user, password: opts.password }));
            const r = await rawRequest(opts, 'POST', '/api/v1/auth/login', { body, contentType: 'application/json', accept: 'application/json' });
            if (r.status !== 200) throw new Error(`登入 ${opts.user} 失敗（HTTP ${r.status}）：${r.body.toString('utf8').slice(0, 200)}`);
            authState = { token: JSON.parse(r.body.toString('utf8')).access_token, at: performance.now(), pending: null };
            return authState.token;
        })().finally(() => { authState.pending = null; });
    }
    return authState.pending;
};

/** 送出請求；API 呼叫自動帶上 access token */
const request = async (opts, method, urlPath, options = {}) => {
    if (!urlPath.startsWith('/api/v1/')) return rawRequest(opts, method, urlPath, options);
    return rawRequest(opts, method, urlPath, { ...options, authorization: `Bearer ${await ensureAuth(opts)}` });
};

const errorDetail = (res) => {
    if (res.error) return res.error;
    const raw = res.body.toString('utf8');
    const htmlTitle = /<title>([^<]*)<\/title>/i.exec(raw)?.[1];
    const text = (htmlTitle || raw.slice(0, 300)).replace(/\s+/g, ' ').trim();
    const hint = { 502: '（通道或代理收到後端斷線）', 524: '（Cloudflare 等後端回應超過 100 秒）', 530: '（Cloudflare 連不到本機通道）' }[res.status] || '';
    return `HTTP ${res.status}${hint} ${text}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 與前端相同的設定檔組裝（對照 src/utils/riskAssessment.ts）
// ─────────────────────────────────────────────────────────────────────────────
const RISK_ATTACK_DEFAULT_PARAMS = { n_iter: 50, ctrl_ratio: 0.2, seed: 42, n_subset: 500, n_repeats: 1, overlap_ratio: 0.0 };

const KANON_FORM = {           // buildKAnonymityApiOptions：K=5、啟用 L=2、T=0.7
    k: 5, l: 2, t: 0.7,
    suppression_limit_percent: 20,
    suppression_method: 'row_suppression',
    limit_exceeded_action: 'allow_with_warning',
};
const DP_FORM = { accumulated_epsilon: 0, accumulated_delta: 0, default_delta: 1e-5 };

const kanonTypeToRisk = { temporal: 'temporal', numeric: 'numeric', categorical: 'categorical', string: 'string' };

/** resolveKAnonymityRiskColumns + buildKAnonymityRiskColumnsForCandidate */
const buildKanonRiskColumns = (kBlock, sensitiveName) => {
    const cols = {};
    for (const [name, c] of Object.entries(kBlock.columns)) {
        if (c.role === 'quasi_identifier' || c.role === 'sensitive') {
            cols[name] = { role: name === sensitiveName ? 'sensitive' : 'quasi_identifier', type: kanonTypeToRisk[c.type] || 'string' };
        }
    }
    return cols;
};

/** buildDifferentialPrivacyRiskColumnsForCandidate */
const dpTypeToRisk = { continuous: 'numeric', datetime: 'temporal', categorical: 'categorical' };
const buildDpRiskColumns = (dpBlock, sensitiveName) => {
    const cols = {};
    for (const [name, b] of Object.entries(dpBlock.column_budgets)) {
        cols[name] = { role: name === sensitiveName ? 'sensitive' : 'quasi_identifier', type: dpTypeToRisk[b.type] || 'string' };
    }
    return cols;
};

const riskAttackConfig = (version, dataset, columns, privacyBlock) => ({
    version, dataset,
    risk_attacks: { enabled: true, columns, ...RISK_ATTACK_DEFAULT_PARAMS },
    ...privacyBlock,
});
const capConfig = (dataset, columns) => ({ version: 'step4_risk_cap', dataset, risk_cap: { enabled: true, columns } });

const jsonPart = (name, obj, filename) => ({ name, filename, contentType: 'application/json', data: Buffer.from(JSON.stringify(obj), 'utf8') });
const csvPart = (name, buf, filename) => ({ name, filename, contentType: 'text/csv', data: buf });

const countCsvRows = (buf) => {
    const text = buf.toString('utf8').replace(/\r\n/g, '\n').trimEnd();
    if (!text) return 0;
    return Math.max(0, text.split('\n').length - 1);
};

// ─────────────────────────────────────────────────────────────────────────────
// 單一虛擬使用者
// ─────────────────────────────────────────────────────────────────────────────
const runUser = async (ctx, userId, mode, phaseLabel) => {
    const { opts, csvBuf, csvName, kanonConfig, dpConfig } = ctx;
    const steps = [];
    const log = (msg) => console.log(`  [${phaseLabel}][U${userId}-${mode}] ${msg}`);
    const t0 = performance.now();
    let failed = null;

    const step = async (name, fn) => {
        if (failed) return null;
        const r = await fn();
        const httpOk = !r.error && r.status >= 200 && r.status < 300;
        const ok = httpOk && (r.check ? r.check() : true);
        // HTTP 本身失敗時顯示狀態碼與回應內容；只有 HTTP 成功但內容不符時才顯示 checkMsg
        const entry = { name, status: r.status, ms: Math.round(r.ms), bytes: r.body?.length || 0, ok, detail: ok ? (r.note || '') : (httpOk ? r.checkMsg : errorDetail(r)) };
        steps.push(entry);
        log(`${ok ? '✓' : '✗'} ${name.padEnd(26)} ${String(entry.status).padStart(3)}  ${(entry.ms / 1000).toFixed(2)}s  ${entry.detail}`);
        if (!ok) failed = `${name}: ${entry.detail}`;
        return ok ? r : null;
    };

    // ① 模擬瀏覽器開頁（index.html + 主要 JS/CSS）
    if (opts.pageLoad) {
        const page = await step('GET / (頁面載入)', () => request(opts, 'GET', '/', { accept: 'text/html' }));
        if (page) {
            const html = page.body.toString('utf8');
            const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
            if (assets.length) {
                await step(`GET 靜態資源 x${assets.length}`, async () => {
                    const s = performance.now();
                    const all = await Promise.all(assets.map((a) => request(opts, 'GET', a)));
                    const bad = all.find((x) => x.error || x.status !== 200);
                    const total = all.reduce((n, x) => n + x.body.length, 0);
                    return { status: bad ? (bad.status || 0) : 200, error: bad?.error || null, body: { length: total }, ms: performance.now() - s, note: `${(total / 1024).toFixed(0)} KB` };
                });
            }
        }
    }

    const taskId = `stress-${phaseLabel}-u${userId}-${Date.now()}`;
    let processedCsv = null, attackReport = null, capReport = null;

    if (mode === 'kanon') {
        const kBlock = kanonConfig.k_anonymity;
        // ② 去識別化
        const deid = await step('POST /k-anonymity', () => {
            const parts = [csvPart('file', csvBuf, csvName), jsonPart('config', kanonConfig, 'config.json'),
                ...Object.entries(KANON_FORM).map(([name, value]) => ({ name, value: String(value) }))];
            const mp = buildMultipart(parts);
            return request(opts, 'POST', '/api/v1/k-anonymity', mp).then((r) => {
                let report = null;
                try { report = r.headers['x-quality-report'] ? JSON.parse(r.headers['x-quality-report']) : null; } catch { /* ignore */ }
                const rows = r.status === 200 ? countCsvRows(r.body) : 0;
                return { ...r, check: () => rows > 0, checkMsg: '回傳 CSV 為空', note: `輸出 ${rows} 筆${report ? `、抑制率 ${report.suppression_rate_percent}%、is_valid=${report.is_valid}` : '（無 x-quality-report）'}` };
            });
        });
        if (deid) processedCsv = deid.body;

        // ③ 三攻擊（敏感欄位候選 = 角色為 sensitive 的欄位，逐一跑）
        const sensitiveList = Object.entries(kBlock.columns).filter(([, c]) => c.role === 'sensitive').map(([n]) => n);
        for (const [i, s] of sensitiveList.entries()) {
            const r = await step(`POST /risk/k-anonymity #${i + 1}`, () => {
                const cfg = riskAttackConfig('step4_risk_k_anonymity', csvName, buildKanonRiskColumns(kBlock, s), { k_anonymity: kBlock });
                const mp = buildMultipart([csvPart('original', csvBuf, csvName), jsonPart('config', cfg, 'risk_config.json')]);
                return request(opts, 'POST', '/api/v1/risk/k-anonymity', mp).then((x) => withAttackCheck(x));
            });
            if (r) attackReport = mergeWorst(attackReport, r.json);
        }
        // ④ CAP
        for (const [i, s] of sensitiveList.entries()) {
            if (!processedCsv) break;
            const r = await step(`POST /risk/cap #${i + 1}`, () => {
                const mp = buildMultipart([csvPart('original', csvBuf, csvName), csvPart('processed', processedCsv, 'processed_dataset.csv'),
                    jsonPart('config', capConfig(csvName, buildKanonRiskColumns(kBlock, s)), 'cap_config.json')]);
                return request(opts, 'POST', '/api/v1/risk/cap', mp).then((x) => withCapCheck(x));
            });
            if (r) capReport = r.json;
        }
    } else {
        const dpBlock = structuredClone(dpConfig.differential_privacy);
        const deid = await step('POST /dp', () => {
            const parts = [csvPart('file', csvBuf, csvName), jsonPart('config', dpConfig, 'config.json'),
                ...Object.entries(DP_FORM).map(([name, value]) => ({ name, value: String(value) }))];
            const mp = buildMultipart(parts);
            return request(opts, 'POST', '/api/v1/dp', mp).then((r) => {
                let report = null;
                try { report = r.headers['x-budget-report'] ? JSON.parse(r.headers['x-budget-report']) : null; } catch { /* ignore */ }
                if (report) { dpBlock.accumulated_epsilon = report.accumulated_epsilon; dpBlock.accumulated_delta = report.accumulated_delta; }
                const rows = r.status === 200 ? countCsvRows(r.body) : 0;
                return { ...r, check: () => rows > 0, checkMsg: '回傳 CSV 為空', note: `輸出 ${rows} 筆${report ? `、消耗 ε=${report.consumed_epsilon}` : '（無 x-budget-report）'}` };
            });
        });
        if (deid) processedCsv = deid.body;

        // 候選敏感欄位 = 已啟用的類別型欄位（selectDifferentialPrivacySensitiveCandidates）
        const candidates = Object.entries(dpBlock.column_budgets).filter(([, b]) => b.type === 'categorical').map(([n]) => n);
        for (const [i, s] of candidates.entries()) {
            const r = await step(`POST /risk/dp #${i + 1} (${s})`, () => {
                const cfg = riskAttackConfig('step4_risk_dp', csvName, buildDpRiskColumns(dpBlock, s), { differential_privacy: dpBlock });
                const mp = buildMultipart([csvPart('original', csvBuf, csvName), jsonPart('config', cfg, 'risk_config.json')]);
                return request(opts, 'POST', '/api/v1/risk/dp', mp).then((x) => withAttackCheck(x));
            });
            if (r) attackReport = mergeWorst(attackReport, r.json);
        }
        for (const [i, s] of candidates.entries()) {
            if (!processedCsv) break;
            const r = await step(`POST /risk/cap #${i + 1} (${s})`, () => {
                const mp = buildMultipart([csvPart('original', csvBuf, csvName), csvPart('processed', processedCsv, 'processed_dataset.csv'),
                    jsonPart('config', capConfig(csvName, buildDpRiskColumns(dpBlock, s)), 'cap_config.json')]);
                return request(opts, 'POST', '/api/v1/risk/cap', mp).then((x) => withCapCheck(x));
            });
            if (r && (!capReport || r.json.cap_after > capReport.cap_after)) capReport = r.json;
        }
    }

    // ⑤ PDF 報告
    if (opts.report && (attackReport || capReport)) {
        await step('POST /report (PDF)', () => {
            const body = Buffer.from(JSON.stringify({ task_id: taskId, attack_report: attackReport, cap_report: capReport }), 'utf8');
            return request(opts, 'POST', '/api/v1/report', { body, contentType: 'application/json', accept: 'application/pdf' }).then((r) => ({
                ...r, check: () => r.body.subarray(0, 4).toString() === '%PDF', checkMsg: '回傳內容不是 PDF', note: `${(r.body.length / 1024).toFixed(0)} KB`,
            }));
        });
    }

    const totalMs = Math.round(performance.now() - t0);
    log(`${failed ? '✗ 失敗' : '✓ 完成'}  總耗時 ${(totalMs / 1000).toFixed(1)}s`);
    return { userId, mode, phase: phaseLabel, ok: !failed, error: failed, totalMs, steps, attackReport, capReport };
};

function withAttackCheck(r) {
    let json = null;
    try { json = JSON.parse(r.body.toString('utf8')); } catch { /* ignore */ }
    const valid = json && ['singling_out_risk', 'linkability_risk', 'inference_risk'].every((k) => typeof json[k] === 'number');
    return { ...r, json, check: () => valid, checkMsg: `回應格式不符（缺三攻擊欄位）：${r.body.toString('utf8').slice(0, 200)}`,
        note: valid ? `指認 ${(json.singling_out_risk * 100).toFixed(1)}% / 連結 ${(json.linkability_risk * 100).toFixed(1)}% / 推斷 ${(json.inference_risk * 100).toFixed(1)}%` : '' };
}
function withCapCheck(r) {
    let json = null;
    try { json = JSON.parse(r.body.toString('utf8')); } catch { /* ignore */ }
    const valid = json && typeof json.cap_before === 'number' && typeof json.cap_after === 'number';
    return { ...r, json, check: () => valid, checkMsg: `回應格式不符（缺 cap_before/cap_after）：${r.body.toString('utf8').slice(0, 200)}`,
        note: valid ? `CAP ${(json.cap_before * 100).toFixed(1)}% → ${(json.cap_after * 100).toFixed(1)}%` : '' };
}
function mergeWorst(prev, cur) {
    if (!prev) return cur;
    const m = (o) => Math.max(o.singling_out_risk, o.linkability_risk, o.inference_risk);
    return { ...(m(cur) > m(prev) ? cur : prev),
        singling_out_risk: Math.max(prev.singling_out_risk, cur.singling_out_risk),
        linkability_risk: Math.max(prev.linkability_risk, cur.linkability_risk),
        inference_risk: Math.max(prev.inference_risk, cur.inference_risk) };
}

// ─────────────────────────────────────────────────────────────────────────────
// docker stats 監看（盡力而為，抓不到就略過）
// ─────────────────────────────────────────────────────────────────────────────
const parseMem = (s) => {
    const m = /([\d.]+)\s*([KMG]i?B)/i.exec(s || '');
    if (!m) return 0;
    const f = { KB: 1 / 1024, KIB: 1 / 1024, MB: 1, MIB: 1, GB: 1024, GIB: 1024 }[m[2].toUpperCase()] || 1;
    return Number(m[1]) * f;
};
const startDockerMonitor = (enabled) => {
    const samples = [];
    if (!enabled) return { stop: () => samples, available: false };
    let stopped = false, child = null, available = true;
    const tick = () => {
        if (stopped) return;
        child = spawn('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'], { shell: false });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('error', () => { available = false; stopped = true; });
        child.on('close', () => {
            const t = Date.now();
            out.trim().split('\n').filter(Boolean).forEach((line) => {
                const [name, cpu, mem] = line.split('\t');
                samples.push({ t, name, cpu: parseFloat(cpu) || 0, memMB: parseMem(mem) });
            });
            if (!stopped) setTimeout(tick, 1000);
        });
    };
    tick();
    return { stop: () => { stopped = true; try { child?.kill(); } catch { /* ignore */ } return samples; }, get available() { return available; } };
};

// ─────────────────────────────────────────────────────────────────────────────
// 統計與報表
// ─────────────────────────────────────────────────────────────────────────────
const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const sec = (ms) => (ms / 1000).toFixed(1) + 's';
const stepKey = (n) => n.replace(/ #\d+.*$/, '').replace(/ x\d+$/, '');

const summarize = (opts, meta, baselineRuns, concurrentRuns, dockerSamples) => {
    const lines = [];
    const allConc = concurrentRuns;
    const okCount = allConc.filter((r) => r.ok).length;
    const maxTotal = Math.max(0, ...allConc.map((r) => r.totalMs));
    const passAllOk = okCount === allConc.length;
    const passTime = maxTotal <= opts.maxSec * 1000;
    const verdict = passAllOk && passTime ? 'PASS ✅' : 'FAIL ❌';

    lines.push(`# Privacy Toolkit Demo 壓力測試報告`, '');
    lines.push(`- 測試時間：${meta.startedAt}`);
    lines.push(`- 目標：${opts.base}`);
    lines.push(`- 併發使用者：${opts.userModes.length} 位（${opts.userModes.map((m) => (m === 'kanon' ? 'K匿名' : 'DP')).join(' / ')}），啟動間隔 ${opts.stagger} ms，重複 ${opts.repeat} 回合`);
    lines.push(`- 資料集：${meta.csvName}（${meta.rows.toLocaleString()} 筆、${meta.cols} 欄、${(meta.bytes / 1024 / 1024).toFixed(2)} MB）`);
    lines.push(`- 判定標準：全部使用者流程成功，且最慢一位 ≤ ${opts.maxSec}s`, '');
    lines.push(`## 結論：${verdict}`, '');
    lines.push(`- 成功 ${okCount}/${allConc.length}；最慢一位完整流程 ${sec(maxTotal)}${passTime ? '' : `（超過 ${opts.maxSec}s 上限）`}`);
    allConc.filter((r) => !r.ok).forEach((r) => lines.push(`- ❌ ${r.phase} U${r.userId}(${r.mode})：${r.error}`));

    // 基準 vs 併發
    if (baselineRuns.length) {
        lines.push('', '## 單人基準 vs 同時使用', '', '| 模式 | 單人完整流程 | 同時使用平均 | 同時使用最慢 | 變慢倍數 |', '|---|---|---|---|---|');
        for (const mode of ['kanon', 'dp']) {
            const b = baselineRuns.find((r) => r.mode === mode && r.ok);
            const c = allConc.filter((r) => r.mode === mode && r.ok).map((r) => r.totalMs);
            if (!b || !c.length) continue;
            const avg = c.reduce((a, x) => a + x, 0) / c.length;
            lines.push(`| ${mode === 'kanon' ? 'K匿名' : 'DP'} | ${sec(b.totalMs)} | ${sec(avg)} | ${sec(Math.max(...c))} | ×${(avg / b.totalMs).toFixed(2)} |`);
        }
    }

    // 每位使用者
    lines.push('', '## 每位使用者（同時使用）', '', '| 回合 | 使用者 | 模式 | 結果 | 總耗時 | 各步驟耗時 |', '|---|---|---|---|---|---|');
    allConc.forEach((r) => {
        const stepsText = r.steps.map((s) => `${s.ok ? '' : '✗'}${s.name.replace('POST ', '').replace(' (頁面載入)', '')} ${sec(s.ms)}`).join('；');
        lines.push(`| ${r.phase} | U${r.userId} | ${r.mode === 'kanon' ? 'K匿名' : 'DP'} | ${r.ok ? '✅' : '❌'} | ${sec(r.totalMs)} | ${stepsText} |`);
    });

    // 每支 API
    const byKey = {};
    allConc.forEach((r) => r.steps.forEach((s) => { (byKey[stepKey(s.name)] ||= []).push(s); }));
    lines.push('', '## 每支 API 回應時間（同時使用）', '', '| API | 次數 | 失敗 | 中位數 | P90 | 最大 |', '|---|---|---|---|---|---|');
    Object.entries(byKey).forEach(([k, arr]) => {
        const ms = arr.map((s) => s.ms);
        lines.push(`| ${k} | ${arr.length} | ${arr.filter((s) => !s.ok).length} | ${sec(pct(ms, 50))} | ${sec(pct(ms, 90))} | ${sec(Math.max(...ms))} |`);
    });

    // docker
    if (dockerSamples.length) {
        const byName = {};
        dockerSamples.forEach((s) => { (byName[s.name] ||= []).push(s); });
        lines.push('', '## 容器資源（docker stats，測試期間）', '', '| 容器 | CPU 平均 | CPU 峰值 | 記憶體峰值 |', '|---|---|---|---|');
        Object.entries(byName).forEach(([name, arr]) => {
            const cpu = arr.map((s) => s.cpu);
            lines.push(`| ${name} | ${(cpu.reduce((a, x) => a + x, 0) / cpu.length).toFixed(0)}% | ${Math.max(...cpu).toFixed(0)}% | ${Math.max(...arr.map((s) => s.memMB)).toFixed(0)} MB |`);
        });
        lines.push('', '> CPU 百分比以單核為 100%，例如 400% 代表吃滿 4 核。');
    } else {
        lines.push('', '> 未取得 docker stats（docker 不在 PATH 或未啟動），沒有後端 CPU／記憶體數據。');
    }

    lines.push('', '## 解讀建議', '',
        '- 失敗訊息含 `socket hang up`、`ECONNRESET`、`502/504`：後端在同時處理時中斷或被重啟（常見原因：記憶體不足被 OOM kill、單一 worker 卡住），請看容器記憶體峰值與 `docker logs`。',
        '- 全部成功但「變慢倍數」接近使用人數（×4 左右）：後端是單 worker 依序處理，同時按執行的人要排隊；Demo 時可錯開按執行，或請後端增加 uvicorn/gunicorn workers。',
        '- 走 cloudflared 通道時若只有大檔案上傳變慢，屬網路頻寬瓶頸，與後端無關。');
    return { markdown: lines.join('\n'), verdict, passAllOk, passTime };
};

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
    const opts = parseArgs(process.argv.slice(2));
    fs.mkdirSync(opts.out, { recursive: true });

    // 資料集
    let csvBuf, csvName;
    if (opts.csv) {
        csvBuf = fs.readFileSync(opts.csv);
        csvName = path.basename(opts.csv);
    } else {
        csvBuf = Buffer.from(generateDemoCsv(opts.rows, 20260930), 'utf8');
        csvName = `demo_stress_${opts.rows}.csv`;
        fs.writeFileSync(path.join(opts.out, csvName), csvBuf);
    }
    const header = csvBuf.toString('utf8', 0, Math.min(csvBuf.length, 4096)).replace(/^\uFEFF/, '').split(/\r?\n/)[0];
    const meta = { startedAt: new Date().toLocaleString('zh-TW', { hour12: false }), csvName, rows: countCsvRows(csvBuf), cols: header.split(',').length, bytes: csvBuf.length };

    const kanonConfig = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'configs', 'config_kanon.json'), 'utf8'));
    const dpConfig = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'configs', 'config_dp.json'), 'utf8'));
    kanonConfig.dataset = csvName; dpConfig.dataset = csvName;
    const ctx = { opts, csvBuf, csvName, kanonConfig, dpConfig };

    console.log(`\n=== Privacy Toolkit Demo 壓力測試 ===`);
    console.log(`目標 ${opts.base}｜使用者 ${opts.userModes.join(',')}｜資料 ${csvName}（${meta.rows} 筆）\n`);

    // 連線預檢
    const ping = await request(opts, 'GET', '/', { accept: 'text/html' });
    if (ping.error || ping.status >= 500) {
        console.error(`✗ 無法連到 ${opts.base}（${errorDetail(ping)}）。請先啟動前端（npm run preview 或 run_preview.bat）與後端 Docker。`);
        process.exit(1);
    }

    try { await ensureAuth(opts); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }

    const docker = startDockerMonitor(opts.docker);

    // 單人基準
    const baselineRuns = [];
    if (opts.baseline) {
        console.log('── 單人基準（依序執行，無人競爭）──');
        for (const mode of [...new Set(opts.userModes)]) baselineRuns.push(await runUser(ctx, 0, mode, 'baseline'));
        console.log('');
    }

    // 同時使用
    const concurrentRuns = [];
    for (let round = 1; round <= opts.repeat; round++) {
        const label = `R${round}`;
        console.log(`── 第 ${round}/${opts.repeat} 回合：${opts.userModes.length} 位同時執行 ──`);
        const promises = opts.userModes.map((mode, i) => new Promise((resolve) => {
            setTimeout(() => resolve(runUser(ctx, i + 1, mode, label)), i * opts.stagger);
        }));
        concurrentRuns.push(...(await Promise.all(promises)));
        console.log('');
    }

    const dockerSamples = docker.stop();
    const { markdown, verdict, passAllOk } = summarize(opts, meta, baselineRuns, concurrentRuns, dockerSamples);

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const mdPath = path.join(opts.out, `stress_report_${stamp}.md`);
    const jsonPath = path.join(opts.out, `stress_raw_${stamp}.json`);
    fs.writeFileSync(mdPath, markdown, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify({ opts: { ...opts, userModes: undefined }, meta, baselineRuns, concurrentRuns, dockerSamples }, null, 2), 'utf8');

    console.log(markdown.split('\n').slice(0, 14).join('\n'));
    console.log(`\n結論：${verdict}`);
    console.log(`完整報告：${mdPath}`);
    console.log(`原始數據：${jsonPath}\n`);
    process.exit(passAllOk ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
