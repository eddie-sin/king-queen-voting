import { useLanguage, useT } from '../i18n/Language.jsx';
import { formatFestivalDate } from '../i18n/locale.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemoryLikes } from './useMemoryLikes.js';
import { Icon } from './MemoryIcon.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { MEMORY_ASSETS as A } from './demo.js';

function GalleryCard({
  photo,
  index,
  api,
  onView,
  refresh,
  retryKey,
  hearts,
  onRequireLogin,
}) {
  const t = useT();
  const { language } = useLanguage();
  const dateLabel = value => formatFestivalDate(value, language);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [retryKey]);

  return (
    <article
      className="mp-print"
      style={{
        '--tilt': `${index % 2 ? 2 : -2}deg`,
        '--delay': `${Math.min(index, 5) * 90}ms`,
      }}
    >
      <div className="mp-folio">
        <span>{t("GUSTO / THADINGYUT")}</span>
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      {failed ? (
        <div className="mp-image-unavailable">
          <p>{t("This photo could not be loaded.")}</p>
          <button className="mp-button mp-outline" onClick={refresh}>{t("Refresh gallery")}</button>
        </div>
      ) : (
        <button
          className="mp-photo-open"
          onClick={() => onView(photo)}
          aria-label={t(`Enlarge memory ${index + 1}`)}
        >
          <img
            src={api.memoryPhotoImageUrl(photo.id)}
            alt={t(`Festival memory from ${dateLabel(photo.createdAt)}`)}
            width="1200"
            height="900"
            loading="lazy"
            onError={() => setFailed(true)}
          />
          <span className="mp-photo-overlay">{t("A closer look +")}</span>
        </button>
      )}
      <div className="mp-print-bottom">
        <time className="mp-date" dateTime={photo.createdAt}>
          {dateLabel(photo.createdAt)}
        </time>
        <Heart photo={photo} hearts={hearts} onRequireLogin={onRequireLogin} />
      </div>
    </article>
  );
}

function Heart({ photo, hearts, onRequireLogin }) {
  const t = useT();
  const { language } = useLanguage();
  const dateLabel = value => formatFestivalDate(value, language);
  const entry = hearts.entries[photo.id];
  const known = typeof entry?.liked === 'boolean';
  return (
    <button
      className={`mp-heart mp-live-heart ${known && entry.liked ? 'is-liked' : ''} ${entry?.pop ? 'mp-heart-pop' : ''}`}
      aria-label={
        t(hearts.anonymous
          ? `Sign in to like memory · ${photo.likeCount} likes`
          : known
            ? `${entry.liked ? 'Unlike' : 'Like'} memory · ${photo.likeCount} likes`
            : `Heart status unavailable · ${photo.likeCount} likes`)
      }
      aria-pressed={known ? entry.liked : undefined}
      disabled={!hearts.anonymous && (!known || entry.busy)}
      onClick={() => (hearts.anonymous ? onRequireLogin() : hearts.toggle(photo.id))}
    >
      <Icon name="heart" />
      <span>{photo.likeCount}</span>
    </button>
  );
}

export default function AllMemories({ api, onRequireLogin }) {
  const t = useT();
  const { language } = useLanguage();
  const dateLabel = value => formatFestivalDate(value, language);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ phase: 'loading', photos: [] });
  const [viewer, setViewer] = useState(null);
  const [imageError, setImageError] = useState(false);
  const serial = useRef(0);
  const scope = useRef(null);
  const [imageAttempt, setImageAttempt] = useState(0);

  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const refreshImages = useCallback(() => {
    setImageAttempt(value => value + 1);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++serial.current;
    const samePage = scope.current?.api === api && scope.current?.page === page;
    scope.current = { api, page };
    // Keep already loaded images mounted during revalidation of the same page.
    // A different page/API, denied response or missing selected photo still clears them.
    if (!samePage) setViewer(null);
    setState(previous =>
      samePage && previous.phase === 'ready'
        ? previous
        : { phase: 'loading', photos: [] },
    );
    api
      .memoryPhotos(page, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && generation === serial.current) {
          setState({ phase: 'ready', ...data, refreshKey: generation });
          setViewer(previous =>
            previous && data.photos.some(photo => photo.id === previous.id)
              ? previous
              : null,
          );
        }
      })
      .catch(error => {
        if (!controller.signal.aborted && generation === serial.current) {
          setViewer(null);
          setState({
            phase: error.status === 403 ? 'disabled' : 'error',
            photos: [],
          });
        }
      });
    return () => {
      controller.abort();
      serial.current++;
    };
  }, [api, page, revision]);

  useEffect(() => {
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const updateLike = useCallback(result => {
    setState(previous => ({
      ...previous,
      photos: previous.photos.map(photo =>
        photo.id === result.photoId ? { ...photo, likeCount: result.likeCount } : photo,
      ),
    }));
  }, []);

  const hearts = useMemoryLikes(
    api,
    state.phase === 'ready' ? state.photos.map(photo => photo.id) : [],
    updateLike,
    refresh,
    revision,
  );
  const shownViewer =
    viewer && (state.photos.find(photo => photo.id === viewer.id) || viewer);

  const messages = {
    loading: ['Gathering our little lights…', 'Opening the festival keepsake.'],
    disabled: [
      'Our keepsake is resting.',
      'Memory Photo is currently disabled by the organisers.',
    ],
    error: [
      'Our memories need a moment.',
      'The gallery could not be loaded. Please try again.',
    ],
  };
  const message = messages[state.phase];

  return (
    <>
      <section className="mp-hero">
        <div className="mp-hero-copy">
          <p className="mp-eyebrow">{t("✦ GUSTO COLLEGE · THADINGYUT 2026")}</p>
          <h1>{t("Our day,")}<br />{t("in ")}<em>{t("lights.")}</em>
          </h1>
          <p className="mp-lead">{t("Little moments.")}<br />{t("Beautifully remembered.")}</p>
          <a className="mp-button mp-gold" href="#memory-upload">{t("Share your memory")}</a>
          <span className="mp-signature">{t("a little light, a little us ↗")}</span>
        </div>
        <div className="mp-hero-art mp-live-art">
          <img src={A + 'memory-keepsake-lantern.svg'} alt="" />
          <div className="mp-seal" aria-hidden="true">
            <span>{t("GUSTO COLLEGE")}</span>
            <b>{t("Made of")}<br />
              <em>{t("memories.")}</em>
            </b>
            <small>✦ 2026 ✦</small>
          </div>
        </div>
      </section>

      <section
        className="mp-wall"
        aria-labelledby="mp-wall-title"
        aria-busy={state.phase === 'loading'}
      >
        <div className="mp-section-heading">
          <div>
            <p className="mp-eyebrow">{t("THE COLLEGE KEEPSAKE")}</p>
            <h2 id="mp-wall-title">{t("Through ")}<em>{t("our eyes.")}</em>
            </h2>
          </div>
          <span className="mp-album-mark">{t("Our people. Our little traditions.")}<small>{t("GUSTO · 2026")}</small>
          </span>
        </div>

        {message ? (
          <div
            className="mp-mine-state"
            role={state.phase === 'error' ? 'alert' : 'status'}
          >
            <h3>{t(message[0])}</h3>
            <p>{t(message[1])}</p>
            {state.phase !== 'loading' && (
              <button className="mp-button mp-outline" onClick={refresh}>{t("Try again")}</button>
            )}
          </div>
        ) : (
          <>
            {state.photos.length ? (
              <div className="mp-grid">
                {state.photos.map((photo, index) => (
                  <GalleryCard
                    key={photo.id}
                    photo={photo}
                    index={index}
                    api={api}
                    refresh={refreshImages}
                    retryKey={imageAttempt}
                    hearts={hearts}
                    onRequireLogin={onRequireLogin}
                    onView={photo => {
                      setImageError(false);
                      setViewer(photo);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="mp-mine-state" role="status">
                <h3>
                  {t(page === 1
                    ? 'The first light is still to come.'
                    : 'No more memories on this page.')}
                </h3>
                <p>{t("Approved festival photos will appear here.")}</p>
              </div>
            )}

            <nav className="mp-pagination" aria-label={t("Gallery pagination")}>
              <button
                className="mp-button mp-outline"
                disabled={state.pagination.page === 1}
                onClick={() => setPage(state.pagination.page - 1)}
              >{t("Previous")}</button>
              <span role="status">{t("Page ")}{state.pagination.page}</span>
              <button
                className="mp-button mp-outline"
                disabled={!state.pagination.hasMore}
                onClick={() => setPage(state.pagination.page + 1)}
              >{t("Next")}</button>
            </nav>

            <div className="mp-mine-actions">
              <button className="mp-button mp-outline" onClick={refreshImages}>{t("Refresh gallery")}</button>
            </div>
          </>
        )}

        {hearts.notice && (
          <div className="mp-like-notice" role="status">
            <p>{t(hearts.notice)}</p>
            {!hearts.anonymous && (
              <button className="mp-button mp-outline" onClick={hearts.retry}>{t("Retry heart states")}</button>
            )}
          </div>
        )}

        <a className="mp-sample-link" href="#memory-gallery-demo">{t("View explicitly labeled demo gallery")}</a>
      </section>

      {viewer && state.phase === 'ready' && (
        <Dialog
          title={t("A little closer.")}
          className="mp-viewer"
          onClose={() => setViewer(null)}
        >
          {imageError ? (
            <div role="alert">
              <p>{t("This photo could not be loaded.")}</p>
              <button
                className="mp-button mp-outline"
                onClick={() => setImageError(false)}
              >{t("Try loading photo again")}</button>
            </div>
          ) : (
            <img
              src={api.memoryPhotoImageUrl(viewer.id)}
              alt={t(`Festival memory from ${dateLabel(viewer.createdAt)}`)}
              onError={() => setImageError(true)}
            />
          )}
          <div className="mp-viewer-bottom">
            <time dateTime={viewer.createdAt}>{dateLabel(viewer.createdAt)}</time>
            <Heart
              photo={shownViewer}
              hearts={hearts}
              onRequireLogin={onRequireLogin}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
