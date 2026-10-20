import type { GlobalThemeOverrides } from 'naive-ui'

// Keep in sync with --pl-font / --pl-mono and the colour tokens in src/styles/main.css.
const FONT =
  '"Schibsted Grotesk Variable", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'

const shared: GlobalThemeOverrides['common'] = {
  fontFamily: FONT,
  fontFamilyMono: MONO,
  borderRadius: '8px',
  borderRadiusSmall: '6px',
}

export const lightOverrides: GlobalThemeOverrides = {
  common: {
    ...shared,
    primaryColor: '#0F6A8B',
    primaryColorHover: '#1A7FA3',
    primaryColorPressed: '#0B5670',
    primaryColorSuppl: '#1A7FA3',
    bodyColor: '#F3F4F6',
    textColorBase: '#13161B',
    textColor1: '#13161B',
    textColor2: '#2B3038',
    textColor3: '#5B6471',
    dividerColor: '#E1E4E9',
    borderColor: '#D9DDE3',
  },
  Layout: { color: '#F3F4F6', headerColor: '#FFFFFF', siderColor: '#FFFFFF' },
}

export const darkOverrides: GlobalThemeOverrides = {
  common: {
    ...shared,
    primaryColor: '#7FD3EA',
    primaryColorHover: '#9FDDEF',
    primaryColorPressed: '#5FBFD9',
    primaryColorSuppl: '#9FDDEF',
    bodyColor: '#0E1116',
    cardColor: '#151920',
    modalColor: '#151920',
    popoverColor: '#1D222B',
    inputColor: '#0B0D11',
    dividerColor: '#262C35',
    borderColor: '#2A313C',
  },
  Layout: { color: '#0E1116', headerColor: '#0E1116', siderColor: '#151920' },
}
