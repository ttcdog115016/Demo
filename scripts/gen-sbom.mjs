/**
 * 產生前端軟體物料清單（SBOM）：CycloneDX 1.5 JSON，只列正式執行相依（不含 devDependencies）。
 *
 * 用法：npm run sbom（需先 npm install，授權資訊取自 node_modules）
 * 輸出：
 *   sbom/frontend-sbom.cdx.json              機器可讀，版面比照後端 SBOM（backend-sbom.cdx.json）
 *   sbom/frontend-sbom.md                    中文摘要（直接相依、授權統計）
 *   sbom/FRONTEND_THIRD_PARTY_LICENSES.md    授權清單，比照後端 THIRD_PARTY_LICENSES.md（套件｜版本｜授權｜網址）
 *   sbom/FRONTEND_THIRD_PARTY_NOTICES.txt    授權全文，比照後端 THIRD_PARTY_NOTICES.txt
 * ★ 2026-11-04：新增授權清單與授權全文；SBOM 版面改為比照後端（serialNumber、tools 清單、精簡的 externalReferences）。
 *   套件沒附授權檔時，改用 sbom/license-fallbacks/<套件>.txt（取自上游原始碼庫，第一行 SOURCE: 註明來源）。
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sbom');
const COMPONENT_NAME = 'open-pets-frontend';
// 與後端 open-pets 同一個交付版本（★ 2026-11-04 改為 2.0.2）；package.json 的 version 仍是 Vite 範本的 0.0.0
const COMPONENT_VERSION = '2.0.2';

const rawFile = join(tmpdir(), `open-pets-frontend-sbom-${process.pid}.json`);
// 直接以 node 執行 CLI，不經 npx／shell（Windows 上 npx.cmd 需要 shell，參數不會跳脫）
// xlsx 取自 SheetJS 官方 CDN，cyclonedx-npm 會自動在 purl 加上 download_url
const result = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', '@cyclonedx', 'cyclonedx-npm', 'bin', 'cyclonedx-npm-cli.js'),
        '--omit', 'dev', '--spec-version', '1.5', '--output-format', 'JSON',
        '--output-reproducible', '--flatten-components', '--mc-type', 'application', '--output-file', rawFile],
    { cwd: ROOT, stdio: 'inherit' },
);
if (result.status !== 0) {
    console.error('cyclonedx-npm 執行失敗');
    process.exit(result.status ?? 1);
}
const bom = JSON.parse(readFileSync(rawFile, 'utf-8'));
rmSync(rawFile, { force: true });

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const directNames = new Set(Object.keys(packageJson.dependencies ?? {}));
const componentFullName = (component) => (component.group ? `${component.group}/${component.name}` : component.name);
const licenseText = (component) => (component.licenses ?? [])
    .map((entry) => entry.license?.id ?? entry.license?.name ?? entry.expression)
    .filter(Boolean)
    .join(' / ') || '未標示';

// ---- 拿掉「選用的 peer 相依」：例如 i18next 把 typescript 列為選用 peer，npm 因專案自己有裝（devDependency）
//   而把它算進執行相依樹，但正式建置的產品不含 typescript。只在所有引用者都標為選用時才拿掉。
const packageNameFromRef = (ref) => {
    const lastSegment = ref.split('|').pop();
    return lastSegment.slice(0, lastSegment.lastIndexOf('@'));
};
const readInstalledPackageJson = (name) => {
    try { return JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf-8')); } catch { return null; }
};
const dependentsByRef = new Map();
for (const dependency of bom.dependencies ?? []) {
    for (const targetRef of dependency.dependsOn ?? []) {
        dependentsByRef.set(targetRef, [...(dependentsByRef.get(targetRef) ?? []), dependency.ref]);
    }
}
const optionalPeerRefs = new Set((bom.components ?? []).filter((component) => {
    const name = componentFullName(component);
    const dependentRefs = dependentsByRef.get(component['bom-ref']) ?? [];
    return !directNames.has(name) && dependentRefs.length > 0 && dependentRefs.every((ref) => {
        const dependentPackage = readInstalledPackageJson(packageNameFromRef(ref));
        return Boolean(dependentPackage?.peerDependencies?.[name] && dependentPackage.peerDependenciesMeta?.[name]?.optional);
    });
}).map((component) => component['bom-ref']));
bom.components = (bom.components ?? []).filter((component) => !optionalPeerRefs.has(component['bom-ref']));
bom.dependencies = (bom.dependencies ?? [])
    .filter((dependency) => !optionalPeerRefs.has(dependency.ref))
    .map((dependency) => ({ ...dependency, dependsOn: dependency.dependsOn?.filter((ref) => !optionalPeerRefs.has(ref)) }));
if (optionalPeerRefs.size) console.log(`略過選用 peer 相依：${[...optionalPeerRefs].map(packageNameFromRef).join('、')}`);

// ---- 主元件
bom.metadata.timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const rootRef = bom.metadata.component['bom-ref'];
const newRootRef = `${COMPONENT_NAME}@${COMPONENT_VERSION}`;
const renameRootRef = (ref) => (ref === rootRef ? newRootRef : ref.replace(`${rootRef}|`, `${newRootRef}|`));
bom.metadata.component = {
    ...bom.metadata.component,
    'bom-ref': newRootRef,
    properties: (bom.metadata.component.properties ?? []).filter((property) => property.name !== 'cdx:npm:package:path'),
    name: COMPONENT_NAME,
    version: COMPONENT_VERSION,
    description: '台灣版隱私保護工具套件 Open-PETs 前端介面（React＋Ant Design，於瀏覽器或桌面版 WebView2 執行）',
    licenses: [{ license: { id: 'MIT' } }],
};
delete bom.metadata.component.purl;
bom.metadata.properties = [
    { name: 'openpets:source', value: 'package.json 的 dependencies（不含 devDependencies：建置、測試工具不隨產品交付）' },
    { name: 'openpets:lockfile', value: 'package-lock.json（相依版本的權威來源）' },
    { name: 'openpets:generator', value: 'npm run sbom（scripts/gen-sbom.mjs，@cyclonedx/cyclonedx-npm）' },
];

// ---- 元件：標示直接／間接相依（同後端 SBOM 的 openpets:category）
const installedPathByComponent = new Map(); // 同名同版本可能裝在不同位置（例如 tslib 2.3.0 在 echarts、zrender 底下各一份）
for (const component of bom.components ?? []) {
    installedPathByComponent.set(component, (component.properties ?? []).find((property) => property.name === 'cdx:npm:package:path')?.value);
    const isDirect = directNames.has(componentFullName(component));
    component.properties = [
        ...(component.properties ?? []).filter((property) => !property.name.startsWith('cdx:npm:package:path')),
        { name: 'openpets:category', value: isDirect ? '直接相依' : '間接相依' },
    ];
}
const components = [...(bom.components ?? [])].sort((left, right) => componentFullName(left).localeCompare(componentFullName(right)));
bom.components = components;
// bom-ref 以主元件開頭（privacy-toolkit@0.0.0|…），改成交付名稱
for (const component of components) component['bom-ref'] = renameRootRef(component['bom-ref']);
bom.dependencies = bom.dependencies.map((dependency) => ({
    ...dependency,
    ref: renameRootRef(dependency.ref),
    ...(dependency.dependsOn ? { dependsOn: dependency.dependsOn.map(renameRootRef) } : {}),
}));

// ---- SBOM 版面比照後端（uv 產生的 backend-sbom.cdx.json）：serialNumber、tools 清單、精簡的 externalReferences
const toolEntries = (bom.metadata.tools?.components ?? []).filter((tool) => tool.name === 'cyclonedx-npm');
bom.metadata.tools = toolEntries.map((tool) => ({ vendor: 'OWASP CycloneDX', name: tool.name, version: tool.version }));
for (const component of components) {
    component.externalReferences = (component.externalReferences ?? [])
        .filter((reference) => reference.type !== 'issue-tracker')
        .map(({ comment, ...reference }) => reference); // 拿掉 "as detected from …" 註解
}
const orderedBom = { bomFormat: bom.bomFormat, specVersion: bom.specVersion, serialNumber: `urn:uuid:${randomUUID()}`, version: bom.version, metadata: bom.metadata, components: bom.components, dependencies: bom.dependencies };

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'frontend-sbom.cdx.json'), `${JSON.stringify(orderedBom, null, 2)}\n`, 'utf-8');

// ---- 授權清單與授權全文（比照後端 THIRD_PARTY_LICENSES.md、THIRD_PARTY_NOTICES.txt）
const FALLBACK_DIR = join(OUT_DIR, 'license-fallbacks');
const LICENSE_FILE_PATTERN = /^(LICEN[CS]E|COPYING|NOTICE)/i;
const listLicenseFiles = (directory) => (existsSync(directory) ? readdirSync(directory, { withFileTypes: true }) : [])
    .filter((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name)).map((entry) => entry.name).sort();
const normalizeNewlines = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
const toHttps = (url) => url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '').replace(/#.*$/, '');
const urlOf = (component) => {
    const references = component.externalReferences ?? [];
    const website = references.find((reference) => reference.type === 'website')?.url;
    const vcs = references.find((reference) => reference.type === 'vcs')?.url;
    return toHttps(website ?? vcs ?? `https://www.npmjs.com/package/${componentFullName(component)}`);
};
const readLicenseTexts = (component) => {
    const fullName = componentFullName(component);
    const recorded = installedPathByComponent.get(component);
    const packageDirectory = join(ROOT, recorded && existsSync(join(ROOT, recorded, 'package.json')) ? recorded : join('node_modules', ...fullName.split('/')));
    const blocks = [];
    const files = listLicenseFiles(packageDirectory);
    for (const name of files) blocks.push({ label: name, text: normalizeNewlines(readFileSync(join(packageDirectory, name), 'utf-8')) });
    // 內含（vendored）的第三方套件另附授權檔：例如 victory-vendor 的 lib-vendor/d3-*
    const vendorDirectory = join(packageDirectory, 'lib-vendor');
    if (existsSync(vendorDirectory)) {
        const vendorEntries = readdirSync(vendorDirectory, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of vendorEntries) {
            for (const name of listLicenseFiles(join(vendorDirectory, entry.name))) {
                blocks.push({ label: `內含 ${entry.name} 的授權（lib-vendor/${entry.name}/${name}）`, text: normalizeNewlines(readFileSync(join(vendorDirectory, entry.name, name), 'utf-8')) });
            }
        }
    }
    let source = 'package';
    if (!files.length) {
        const fallbackFile = join(FALLBACK_DIR, `${fullName.replace('/', '__').replace('@', '')}.txt`);
        if (existsSync(fallbackFile)) {
            const [sourceLine, ...rest] = normalizeNewlines(readFileSync(fallbackFile, 'utf-8')).split('\n');
            blocks.unshift({ label: null, text: `（套件未附授權檔，以下授權全文取自上游原始碼庫：${sourceLine.replace(/^SOURCE:\s*/, '')}）\n\n${rest.join('\n').trim()}` });
            source = 'upstream';
        } else {
            blocks.push({ label: null, text: `（套件未附授權檔，授權：${licenseText(component)}；${urlOf(component)}）` });
            source = 'none';
        }
    }
    return { blocks, source };
};
const uniqueComponents = [];
const seenKeys = new Set();
for (const component of components) {
    const key = `${componentFullName(component)}@${component.version}`;
    if (seenKeys.has(key)) continue; // 同名同版本（不同位置）的授權只列一次
    seenKeys.add(key);
    uniqueComponents.push(component);
}
const SEPARATOR_THICK = '='.repeat(78);
const SEPARATOR_THIN = '-'.repeat(78);
const noticeLines = [];
const licenseSources = { package: [], upstream: [], none: [] };
for (const component of uniqueComponents) {
    const { blocks, source } = readLicenseTexts(component);
    licenseSources[source].push(`${componentFullName(component)}@${component.version}`);
    noticeLines.push(SEPARATOR_THICK, `${componentFullName(component)} ${component.version} — ${licenseText(component)}`, urlOf(component), SEPARATOR_THIN);
    blocks.forEach((block, index) => {
        if (index > 0) noticeLines.push('');
        if (block.label && blocks.length > 1) noticeLines.push(`[${block.label}]`, '');
        noticeLines.push(block.text);
    });
    noticeLines.push('');
}
writeFileSync(join(OUT_DIR, 'FRONTEND_THIRD_PARTY_NOTICES.txt'), `${noticeLines.join('\n')}\n`, 'utf-8');

const licenseNotes = [
    ['dompurify', '**dompurify（MPL-2.0 OR Apache-2.0）**：雙授權，擇一適用；本專案以 Apache-2.0 使用，未修改其原始碼。MPL-2.0 全文（`LICENSE-MPL`）一併收錄於授權全文。'],
    ['rgbcolor', '**rgbcolor（MIT OR SEE LICENSE IN FEEL-FREE.md）**：套件宣告為 MIT，並附 FEEL-FREE.md 說明；授權全文見 `FRONTEND_THIRD_PARTY_NOTICES.txt`。'],
    ['xlsx', '**xlsx（Apache-2.0）**：取自 SheetJS 官方 CDN（cdn.sheetjs.com/xlsx-0.20.3），npm 上的版本較舊且有已知弱點。'],
    ['victory-vendor', '**victory-vendor（MIT AND ISC）**：內含 d3 等第三方套件（ISC、BSD-3-Clause 等），各自的授權檔已一併收錄於授權全文。'],
    ['size-sensor', '**size-sensor（ISC）**：套件及上游原始碼庫都沒有附授權檔，授權全文欄位僅列授權種類與網址。'],
];
const presentNames = new Set(components.map(componentFullName));
const licensesMarkdown = [
    `# OpenPETs ${COMPONENT_VERSION} 前端第三方元件授權清單`,
    '',
    `SBOM（CycloneDX ${bom.specVersion}）：前端 \`frontend-sbom.cdx.json\`（依 \`package-lock.json\` 產生，僅含執行期相依）。`,
    '各 npm 套件授權全文見 `FRONTEND_THIRD_PARTY_NOTICES.txt`。',
    `共 ${uniqueComponents.length} 筆（SBOM 共 ${components.length} 個元件；同名同版本但安裝在不同位置的元件，授權只列一次）。`,
    '',
    '## 前端 npm 套件（執行期）',
    '',
    '| 套件 | 版本 | 授權 | 網址 |',
    '|---|---|---|---|',
    ...uniqueComponents.map((component) => `| ${componentFullName(component)} | ${component.version} | ${licenseText(component).replace(/\|/g, '\\|')} | ${urlOf(component)} |`),
    '',
    '## 授權注意事項',
    '',
    ...licenseNotes.filter(([name]) => presentNames.has(name)).map(([, note]) => `- ${note}`),
    '- 其餘元件為 MIT、ISC、BSD、Apache-2.0、0BSD 等寬鬆授權，沒有著佐權（copyleft）授權元件。',
    '',
];
writeFileSync(join(OUT_DIR, 'FRONTEND_THIRD_PARTY_LICENSES.md'), licensesMarkdown.join('\n'), 'utf-8');
console.log(`授權全文：${uniqueComponents.length} 段（套件自附 ${licenseSources.package.length}、取自上游 ${licenseSources.upstream.length}：${licenseSources.upstream.join('、') || '無'}；無授權檔 ${licenseSources.none.length}：${licenseSources.none.join('、') || '無'}）`);

// ---- 中文摘要
const directComponents = components.filter((component) => directNames.has(componentFullName(component)));
const licenseCounts = new Map();
for (const component of components) {
    const license = licenseText(component);
    licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}
const lines = [
    '# Open-PETs 前端軟體物料清單（SBOM）摘要',
    '',
    `- 產生時間：${bom.metadata.timestamp}`,
    `- 格式：CycloneDX ${bom.specVersion}（JSON），完整清單見 \`frontend-sbom.cdx.json\``,
    `- 主元件：${COMPONENT_NAME} ${COMPONENT_VERSION}（MIT）`,
    '- 範圍：正式執行相依（package.json 的 dependencies 及其傳遞相依）；建置與測試工具（devDependencies）不隨產品交付，不列入',
    `- 元件總數：${components.length}（直接相依 ${directComponents.length}、間接相依 ${components.length - directComponents.length}）`,
    '- 後端（Python）SBOM 另見交付套件「3.2_附件二_軟體物料清單SBOM.json」',
    '- 授權清單與授權全文：`FRONTEND_THIRD_PARTY_LICENSES.md`、`FRONTEND_THIRD_PARTY_NOTICES.txt`（格式比照後端的 THIRD_PARTY_LICENSES.md、THIRD_PARTY_NOTICES.txt）',
    '- 重新產生：`npm install` 後執行 `npm run sbom`',
    '',
    '## 直接相依',
    '',
    '| 套件 | 版本 | 授權 |',
    '|---|---|---|',
    ...directComponents.map((component) => `| ${componentFullName(component)} | ${component.version} | ${licenseText(component)} |`),
    '',
    '## 授權統計（全部元件）',
    '',
    '| 授權 | 元件數 |',
    '|---|---|',
    ...[...licenseCounts.entries()].sort((left, right) => right[1] - left[1]).map(([license, count]) => `| ${license} | ${count} |`),
    '',
];
writeFileSync(join(OUT_DIR, 'frontend-sbom.md'), lines.join('\n'), 'utf-8');
console.log(`SBOM 已輸出：sbom/frontend-sbom.cdx.json（${components.length} 個元件）、sbom/frontend-sbom.md`);
