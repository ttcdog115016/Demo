/**
 * 產生前端軟體物料清單（SBOM）：CycloneDX 1.5 JSON，只列正式執行相依（不含 devDependencies）。
 *
 * 用法：npm run sbom（需先 npm install，授權資訊取自 node_modules）
 * 輸出：
 *   sbom/frontend-sbom.cdx.json  機器可讀，格式同交付套件「3.2_附件二_軟體物料清單SBOM.json」（後端）
 *   sbom/frontend-sbom.md        中文摘要（直接相依、授權統計）
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sbom');
const COMPONENT_NAME = 'open-pets-frontend';
// 與後端 SBOM（open-pets 2.0.0）同一個交付版本；package.json 的 version 仍是 Vite 範本的 0.0.0
const COMPONENT_VERSION = '2.0.0';

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
for (const component of bom.components ?? []) {
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

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'frontend-sbom.cdx.json'), `${JSON.stringify(bom, null, 2)}\n`, 'utf-8');

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
