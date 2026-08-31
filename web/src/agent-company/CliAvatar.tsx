interface CliAvatarProps {
  label: string
  presetId?: string | null
  size?: 'small' | 'large'
}

/** Displays the actual CLI identity so members are recognized by their runtime, not role initials. */
export const CliAvatar = ({ label, presetId, size = 'small' }: CliAvatarProps) => {
  const cli = presetId === 'codex' ? 'codex' : 'claude'
  return (
    <span
      className={`ac-cli-avatar ac-cli-avatar--${cli} ac-cli-avatar--${size}`}
      title={`${label} · ${cli === 'codex' ? 'Codex CLI' : 'Claude CLI'}`}
      role="img"
      aria-label={`${label} 使用 ${cli === 'codex' ? 'Codex CLI' : 'Claude CLI'}`}
    >
      <img src={`/cli-icons/${cli}.png`} alt="" />
    </span>
  )
}
