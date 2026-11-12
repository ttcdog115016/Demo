/**
 * 檔案名稱 (File): ModeInfoPanel.tsx
 * 模組功能 (Description): 管理員「系統設定 → 系統模式」分頁（唯讀）。
 *   顯示目前是本地、內網或線上模式、管理員目前是怎麼連進來的，並用白話說明「要切換到另一個模式，要在主機上做什麼」，附可複製的指令。
 *
 * 為什麼只顯示、不提供切換按鈕：
 *   模式的實質差異都在容器外面——內網要多開 HTTPS 代理容器、改變對外開放的網路範圍、開防火牆、讓使用者電腦信任憑證。
 *   要從網頁做這些，容器必須取得控制 Docker 的權限（等於主機的最高權限），會讓任何一個管理員帳號被盜就能接管主機；
 *   而且切換會重啟正在提供這個網頁的容器，網址也會跟著變。所以切換一律由管理主機的人，用安裝資料夾的 open-pets.ps1／open-pets.sh 進行。
 */
import React from 'react';
import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { RuntimeMode } from '../../config/featureFlags';
import { isLoopbackHostname } from './modeInfo';

const { Text, Paragraph } = Typography;

/** 手冊中「切換模式」那一節（需要網路才打得開） */
const MANUAL_SWITCH_MODE_URL = 'https://ttcdog115016.github.io/Demo/docs/quickstart/#第-5-步切換模式';

const ALL_MODES: RuntimeMode[] = ['local', 'lan', 'online'];

const MODE_TAG_COLOR: Record<RuntimeMode, string> = { local: 'green', lan: 'blue', online: 'purple' };

export interface ModeConnectionInfo
{
	/** 例如 'https:' 或 'http:' */
	protocol: string;
	/** 例如 'localhost'、'192.168.1.20' */
	hostname: string;
	/** 例如 'https://192.168.1.20' */
	origin: string;
}

export interface ModeInfoPanelProps
{
	/** 目前的模式；null 代表這個部署沒有由 Docker 映像檔設定模式（npm run dev、nginx 版 Demo 站等） */
	mode: RuntimeMode | null;
	/** 目前的連線資訊；不傳就讀 window.location（測試時傳入） */
	connection?: ModeConnectionInfo;
}

const readWindowConnection = (): ModeConnectionInfo => ({
	protocol: window.location.protocol,
	hostname: window.location.hostname,
	origin: window.location.origin,
});

const ModeInfoPanel: React.FC<ModeInfoPanelProps> = ({ mode, connection }) =>
{
	const { t: translate } = useTranslation();
	const currentConnection = connection ?? readWindowConnection();
	const isSecure = currentConnection.protocol === 'https:';
	const isLoopback = isLoopbackHostname(currentConnection.hostname);

	const modeNames: Record<RuntimeMode, string> = {
		local: translate('admin.mode_name_local', '本地'),
		lan: translate('admin.mode_name_lan', '內網'),
		online: translate('admin.mode_name_online', '線上'),
	};
	const modeDescriptions: Record<RuntimeMode, string> = {
		local: translate('admin.mode_desc_local', '只有這台電腦能使用，網址是 http://localhost:埠。'),
		lan: translate('admin.mode_desc_lan', '同一個內網的電腦用 https://這台電腦的IP 連進來，每台電腦第一次要信任憑證。'),
		online: translate('admin.mode_desc_online', '以對外網域提供服務，前面要有反向代理與正式的 HTTPS 憑證。'),
	};

	const ipPlaceholder = translate('admin.mode_ph_ip', '這台電腦的IP');
	const domainPlaceholder = translate('admin.mode_ph_domain', '你的網域');

	// 切換到各模式時，在主機上要執行的指令與注意事項
	const switchGuides: Record<RuntimeMode, { commands: string[]; note: string }> = {
		local: {
			commands: ['.\\open-pets.ps1 mode local'],
			note: translate('admin.mode_note_local', '切換後只剩這台電腦能用，其他人會立刻連不上，請先通知使用者。之後想切回內網，憑證沿用，使用者不用重新信任。'),
		},
		lan: {
			commands: [`.\\open-pets.ps1 mode lan -Hosts ${ipPlaceholder}`, '.\\open-pets.ps1 export-ca'],
			note: translate('admin.mode_note_lan', '要開防火牆（工具會印出指令）；執行 export-ca 把憑證與說明交給使用者，每台電腦信任一次；使用者的網址一定要打 https://。'),
		},
		online: {
			commands: [`.\\open-pets.ps1 mode online -Hosts ${domainPlaceholder}`],
			note: translate('admin.mode_note_online', '需要自己的網域、反向代理與正式的 HTTPS 憑證，建議請資訊人員協助。不要把應用程式的埠直接對外開放。'),
		},
	};

	const otherModes = ALL_MODES.filter((candidate) => candidate !== mode);

	return (
		<div style={{ maxWidth: '50em' }} data-testid="mode-info-panel">
			<Card type="inner" title={translate('admin.mode_current_title', '目前模式')} style={{ marginBottom: '16px' }}>
				{mode ? (
					<Space direction="vertical" size={4}>
						<div>
							<Tag color={MODE_TAG_COLOR[mode]} style={{ fontSize: '1.1em', padding: '2px 12px' }} data-testid="mode-current-tag">{modeNames[mode]}</Tag>
						</div>
						<Text>{modeDescriptions[mode]}</Text>
					</Space>
				) : (
					<Alert
						type="info"
						showIcon
						message={translate('admin.mode_name_unknown', '未設定模式')}
						description={translate('admin.mode_desc_unknown', '這個部署不是由 Docker 映像檔的 OPEN_PETS_MODE 決定模式（例如開發環境或展示站），所以沒有可顯示或切換的模式。')}
					/>
				)}
			</Card>

			<Card type="inner" title={translate('admin.mode_conn_title', '你現在的連線')} style={{ marginBottom: '16px' }}>
				<Descriptions column={1} size="small">
					<Descriptions.Item label={translate('admin.mode_conn_address', '網址')}>
						<Text code data-testid="mode-conn-origin">{currentConnection.origin}</Text>
					</Descriptions.Item>
					<Descriptions.Item label={translate('admin.mode_conn_security', '加密')}>
						{isSecure
							? <Tag color="green">{translate('admin.mode_conn_secure_yes', 'HTTPS（已加密）')}</Tag>
							: <Tag color="orange">{translate('admin.mode_conn_secure_no', 'HTTP（未加密）')}</Tag>}
					</Descriptions.Item>
				</Descriptions>

				{(mode === 'lan' || mode === 'online') && !isSecure && !isLoopback && (
					<Alert
						data-testid="mode-warn-plain-http"
						type="warning"
						showIcon
						style={{ marginTop: '12px' }}
						message={translate('admin.mode_warn_plain_http', '你現在是用沒有加密的 http 連線。帳號密碼與資料會以明文在網路上傳送，請改用 https:// 開頭的網址。')}
					/>
				)}
				{mode === 'local' && !isLoopback && (
					<Alert
						data-testid="mode-warn-local-remote"
						type="warning"
						showIcon
						style={{ marginTop: '12px' }}
						message={translate('admin.mode_warn_local_remote', '本地模式應該只從這台電腦連入，但你現在是從其他位址連進來的。請確認沒有不小心把應用程式的埠對外開放。')}
					/>
				)}
			</Card>

			{mode && (
				<Card type="inner" title={translate('admin.mode_switch_title', '要切換模式嗎？')}>
					<Alert
						type="info"
						showIcon
						style={{ marginBottom: '16px' }}
						message={translate('admin.mode_switch_why', '模式要在「主機」上切換，不能從網頁切換。')}
						description={translate('admin.mode_switch_why_desc', '切換會重啟系統，並改變誰能連進來（防火牆、HTTPS 憑證），這些必須由管理主機的人操作。切換不會刪除任何資料（帳號、處理紀錄、稽核紀錄、金鑰）。')}
					/>

					<Paragraph type="secondary" style={{ marginBottom: '8px' }}>
						{translate('admin.mode_cmd_hint', '在主機的安裝資料夾開啟 PowerShell，執行下面的指令（Linux 把 .\\open-pets.ps1 換成 ./open-pets.sh，-Hosts 換成 --hosts）：')}
					</Paragraph>

					<Space direction="vertical" size={12} style={{ width: '100%' }}>
						{otherModes.map((targetMode) => (
							<Card key={targetMode} size="small" data-testid={`mode-switch-${targetMode}`}
								title={translate('admin.mode_switch_to', '切換到「{{mode}}」', { mode: modeNames[targetMode] })}>
								<Space direction="vertical" size={6} style={{ width: '100%' }}>
									{switchGuides[targetMode].commands.map((commandText) => (
										<div key={commandText}><Text code copyable>{commandText}</Text></div>
									))}
									<Text type="secondary">{switchGuides[targetMode].note}</Text>
								</Space>
							</Card>
						))}
					</Space>

					<Paragraph style={{ marginTop: '16px', marginBottom: '4px' }}>
						{translate('admin.mode_status_hint', '切換完成後，執行下面的指令確認目前的模式、狀態與網址：')}
						{' '}<Text code copyable>{'.\\open-pets.ps1 status'}</Text>
					</Paragraph>
					<Text type="secondary">
						{translate('admin.mode_manual_hint', '詳細步驟見手冊「新手快速上手」的切換模式一節（需要網路）：')}
						{' '}<a href={MANUAL_SWITCH_MODE_URL} target="_blank" rel="noopener noreferrer">{translate('admin.mode_manual_link', '開啟手冊')}</a>
					</Text>
				</Card>
			)}
		</div>
	);
};

export default ModeInfoPanel;
