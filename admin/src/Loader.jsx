import Icon from './Icon.jsx';

export function Spinner({ size = 15, className = '' }) {
  return (
    <svg
      className={`admin-spinner ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="admin-spinner-track"
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        className="admin-spinner-arc"
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AdminLoader({
  label = 'Loading workspace…',
  hint = 'Synchronizing festival administration data',
  icon = 'crown',
  compact = false,
  role = 'status',
}) {
  return (
    <div
      className={`admin-loader ${compact ? 'admin-loader--compact' : ''}`}
      role={role}
      aria-live="polite"
    >
      <div className="admin-loader-emblem" aria-hidden="true">
        <span className="admin-loader-ring admin-loader-ring--outer" />
        <span className="admin-loader-ring admin-loader-ring--inner" />
        <span className="admin-loader-core">
          <Icon name={icon} size={compact ? 18 : 24} />
        </span>
      </div>
      <div className="admin-loader-copy">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="admin-loader-bar" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
