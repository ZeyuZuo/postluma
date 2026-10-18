import type { GlobalThemeOverrides } from 'naive-ui'

const FONT =
  'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'

const shared: GlobalThemeOverrides['common'] = {
  fontFamily: FONT,
  fontFamilyMono: MONO,
  borderRadius: '6px',
}

export const lightOverrides: GlobalThemeOverrides = {
  common: {
    ...shared,
    primaryColor: '#2E5AAC',
    primaryColorHover: '#3D6BC0',
    primaryColorPressed: '#244A90',
    primaryColorSuppl: '#3D6BC0',
    bodyColor: '#F5F6F8',
    textColorBase: '#1C2430',
  },
  Layout: { color: '#F5F6F8', headerColor: '#F5F6F8', siderColor: '#FFFFFF' },
}

export const darkOverrides: GlobalThemeOverrides = {
  common: {
    ...shared,
    primaryColor: '#86A8EE',
    primaryColorHover: '#9DB9F2',
    primaryColorPressed: '#6E91DA',
    primaryColorSuppl: '#9DB9F2',
    bodyColor: '#15181D',
    cardColor: '#1C2027',
    modalColor: '#1C2027',
    popoverColor: '#232831',
  },
  Layout: { color: '#15181D', headerColor: '#15181D', siderColor: '#1C2027' },
}
