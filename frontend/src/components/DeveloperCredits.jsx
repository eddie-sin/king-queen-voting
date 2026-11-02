import { useEffect, useRef, useState } from 'react';
import './developer-credits.css';

const PAGE_CREDITS = {
  home: {
    label: 'Home Page',
    roles: {
      Design: ['Lin Khant Kyaw (Noah)', 'Kaung Zaw Hein'],
      Frontend: ['Kaung Zaw Hein'],
      Backend: ['Thant Sin Aung (Eddie)'],
    },
  },
  kingQueen: {
    label: 'King & Queen Page',
    roles: {
      Design: ['Zin Zin Pwint Han (Nikolai)'],
      Frontend: ['Zin Zin Pwint Han (Nikolai)'],
      Backend: ['Niko'],
    },
  },
  lanterns: {
    label: 'Lanterns Page',
    roles: {
      Design: ['Pwint Phyu Soe (Moon)'],
      Frontend: ['Zin Zin Pwint Han (Nikolai)'],
      Backend: ['Aung Myint Myat (Joseph)'],
    },
  },
  wishes: {
    label: 'Wish Sky',
    roles: {
      Design: ['Zin Zin Pwint Han (Nikolai)'],
      Frontend: ['Zin Zin Pwint Han (Nikolai)'],
      Backend: ['Hnin Thiri'],
    },
  },
  memory: {
    label: 'Memory Photo',
    roles: {
      Design: ['Shin Thant'],
      Frontend: ['Shun Lak Thaw Tar'],
      Backend: ['Shun Lak Thaw Tar'],
    },
  },
  entertainment: {
    label: 'Entertainment',
    roles: {
      Design: ['Lin Khant Kyaw (Noah)'],
      Frontend: ['Lin Khant Kyaw (Noah)'],
      Backend: ['Kaung Myat'],
    },
  },
  account: {
    label: 'Account Page',
    roles: {
      Design: ['Thant Sin Aung (Eddie)'],
      Frontend: ['Thant Sin Aung (Eddie)'],
      Backend: ['Thant Sin Aung (Eddie)'],
    },
  },
  developers: {
    label: 'Developer Page',
    roles: {
      Design: ['Kaung Zaw Hein'],
      Frontend: ['Kaung Zaw Hein'],
      Backend: ['Kaung Zaw Hein'],
    },
  },
};

const ROUTE_TO_GROUP = {
  home: 'home',
  candidates: 'kingQueen',
  king: 'kingQueen',
  queen: 'kingQueen',
  results: 'kingQueen',
  lanterns: 'lanterns',
  'lantern-results': 'lanterns',
  wishes: 'wishes',
  'my-wishes': 'wishes',
  'memory-gallery': 'memory',
  'my-memories': 'memory',
  'memory-upload': 'memory',
  entertainment: 'entertainment',
  account: 'account',
  privacy: 'account',
  developers: 'developers',
};

function formatContributorName(entry) {
  const match = entry.match(/^(.*?)\s*(\([^)]+\))$/);
  if (!match) return <span className="dev-credit-person-name">{entry}</span>;
  return (
    <>
      <span className="dev-credit-person-name">{match[1]}</span>{' '}
      <span className="dev-credit-person-alias">{match[2]}</span>
    </>
  );
}

export default function DeveloperCredits({ pageKey }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const timerRef = useRef(null);

  const groupKey = ROUTE_TO_GROUP[pageKey] || 'home';
  const current = PAGE_CREDITS[groupKey] || PAGE_CREDITS.home;
  const entries = Object.entries(current.roles);

  const openModal = event => {
    clearTimeout(timerRef.current);
    triggerRef.current = event.currentTarget;
    setIsClosing(false);
    setIsOpen(true);
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  };

  const closeModal = callback => {
    if (!dialogRef.current?.open || isClosing) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      dialogRef.current.close();
      setIsOpen(false);
      setIsClosing(false);
      if (typeof callback === 'function') callback();
      else triggerRef.current?.focus();
      return;
    }
    setIsClosing(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dialogRef.current?.close();
      setIsOpen(false);
      setIsClosing(false);
      if (typeof callback === 'function') callback();
      else triggerRef.current?.focus();
    }, 220);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Close smoothly if route changes while open
  useEffect(() => {
    if (dialogRef.current?.open) {
      clearTimeout(timerRef.current);
      dialogRef.current.close();
      setIsOpen(false);
      setIsClosing(false);
    }
  }, [pageKey]);

  const handleViewDetails = event => {
    event.preventDefault();
    closeModal(() => {
      location.hash = '#developers';
    });
  };

  return (
    <>
      <button
        type="button"
        className={`dev-info-fab ${isOpen ? 'is-active' : ''}`}
        aria-label="Who made this page?"
        title="Who made this page?"
        onClick={openModal}
      >
        <span className="dev-info-fab-icon" aria-hidden="true">
          i
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className={`dev-credit-dialog ${isClosing ? 'is-closing' : ''}`}
        aria-labelledby="dev-credit-title"
        onCancel={event => {
          event.preventDefault();
          closeModal();
        }}
        onClick={event => {
          if (event.target === event.currentTarget) closeModal();
        }}
      >
        <div className="dev-credit-surface" key={groupKey}>
          <header className="dev-credit-header">
            <div className="dev-credit-title-group">
              <span className="dev-credit-page-tag">
                <i aria-hidden="true">✦</i> {current.label}
              </span>
              <h2 id="dev-credit-title">Who made this page?</h2>
            </div>
            <button
              type="button"
              className="dev-credit-close"
              onClick={() => closeModal()}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <dl className="dev-credit-list">
            {entries.map(([role, people], index) => (
              <div
                className="dev-credit-row"
                key={role}
                style={{ '--row-index': index }}
              >
                <dt className="dev-credit-role">{role}</dt>
                <dd className="dev-credit-people">
                  {people.map(person => (
                    <span className="dev-credit-person" key={person}>
                      {formatContributorName(person)}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>

          <footer className="dev-credit-footer">
            <a
              href="#developers"
              className="dev-credit-details-link"
              onClick={handleViewDetails}
            >
              <span>View details</span>
              <span className="dev-credit-arrow" aria-hidden="true">
                →
              </span>
            </a>
          </footer>
        </div>
      </dialog>
    </>
  );
}
