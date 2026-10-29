import { useT } from '../i18n/Language.jsx';
import { useEffect, useRef, useState } from 'react';
import { FestivalMotion } from './FestivalMotion.jsx';
import { Icon } from './MemoryIcon.jsx';
import ConnectedUpload from './ConnectedUpload.jsx';
import { Dialog } from '../components/Dialog.jsx';
import AllMemories from './AllMemories.jsx';
import MyMemories from './MyMemories.jsx';
import { ReviewEnvelope } from './ReviewEnvelope.jsx';
import { DEMO_PHOTOS, MEMORY_ASSETS as A, MEMORY_TABS, selectionError } from './demo.js';
import './memory.css';

function PhotoCard({ photo, index, liked, onLike, onView, personal = false }) {
  const t = useT();
  return (
    <article
      className={`mp-print ${personal ? 'mp-opened' : ''}`}
      style={{ '--tilt': `${index % 2 ? 2 : -2}deg`, '--delay': `${index * 90}ms` }}
    >
      <div className="mp-folio">
        <span>{t("GUSTO / THADINGYUT")}</span>
        <span>0{index + 1}</span>
      </div>
      <button
        className="mp-photo-open"
        onClick={() => onView(photo)}
        aria-label={t(`Enlarge demo photo ${index + 1}`)}
      >
        <img
          src={A + photo.image}
          alt={t(photo.alt)}
          loading="lazy"
          width="1200"
          height="900"
        />
        <span className="mp-photo-overlay">{t("A closer look ")}<Icon name="plus" />
        </span>
        <span className="mp-demo-chip">{t("Demo photograph")}</span>
      </button>
      <div className="mp-print-bottom">
        <div>
          <span className="mp-date">{t(photo.date)}</span>
          {personal && (
            <span className="mp-status mp-approved">{t("Approved · opened & shared")}</span>
          )}
        </div>
        <button
          className={`mp-heart ${liked ? 'is-liked' : ''}`}
          aria-label={t(`${liked ? 'Unlike' : 'Like'} demo photo ${index + 1}`)}
          aria-pressed={liked}
          onClick={() => onLike(photo.id)}
        >
          <Icon name="heart" />
          <span>{photo.likes + (liked ? 1 : 0)}</span>
        </button>
      </div>
    </article>
  );
}

function UploadStudio() {
  const t = useT();
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [previewed, setPreviewed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const selectedRef = useRef([]);
  const files = useRef(null);
  const camera = useRef(null);

  useEffect(() => () => selectedRef.current.forEach(photo => URL.revokeObjectURL(photo.url)), []);

  function addFiles(list) {
    const next = [...selectedRef.current];
    let problem = '';
    for (const file of list) {
      const invalid = selectionError(file, next.length);
      if (invalid) {
        problem = invalid;
        continue;
      }
      next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    selectedRef.current = next;
    setSelected(next);
    setError(problem);
    setPreviewed(false);
  }

  function remove(id) {
    const photo = selectedRef.current.find(item => item.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    selectedRef.current = selectedRef.current.filter(item => item.id !== id);
    setSelected(selectedRef.current);
    setError('');
    setPreviewed(false);
  }

  return (
    <div className="mp-upload-layout">
      <section className="mp-upload-story">
        <p className="mp-eyebrow">{t("A PAGE IN OUR KEEPSAKE")}</p>
        <h1>{t("Your day.")}<br />
          <em>{t("Your little")}<br />{t(" lights.")}</em>
        </h1>
        <p>{t("Three photos. A few favourite faces.")}<br />{t("A little piece of our Thadingyut.")}</p>
        <img className="mp-story-lantern" src={A + 'memory-keepsake-lantern.svg'} alt="" />
        <div className="mp-story-print">
          <img
            src={A + 'campus-together.png'}
            alt={t("Illustrative college celebration; demo content")}
          />
          <span>{t("the good days, kept close.")}</span>
        </div>
        <p className="mp-small-note">{t("✦ A local design preview. Nothing is uploaded.")}</p>
      </section>

      <section className="mp-studio" aria-labelledby="mp-studio-title">
        <div className="mp-studio-top">
          <span className="mp-eyebrow">{t("✦ COLLECT YOUR MOMENTS")}</span>
          <span className="mp-counter">{selected.length}{t(" / 3 selected")}</span>
        </div>
        <h2 id="mp-studio-title">{t("A memory worth ")}<em>{t("keeping.")}</em>
        </h2>
        <p className="mp-muted">{t("Choose a few little pieces of your celebration.")}</p>
        <div className="mp-local-note">
          <Icon name="image" />
          <span>
            <strong>{t("Make yourself at home.")}</strong>{t("This is a local preview. No sign-in, uploads or account changes.")}</span>
        </div>
        <div
          className={`mp-drop ${dragging ? 'is-dragging' : ''}`}
          onDragOver={event => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
          }}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            addFiles([...event.dataTransfer.files]);
          }}
        >
          <div className="mp-slots">
            {[0, 1, 2].map(index => (
              <div
                className={`mp-slot ${selected[index] ? 'is-filled' : ''}`}
                key={index}
              >
                {selected[index] ? (
                  <>
                    <img
                      src={selected[index].url}
                      alt={t(`Selected local photo ${index + 1}`)}
                    />
                    <button
                      className="mp-remove"
                      aria-label={t(`Remove selected photo ${index + 1}`)}
                      onClick={() => remove(selected[index].id)}
                    >
                      ×
                    </button>
                    <span className="mp-slot-label">{t("Photo ")}{index + 1}</span>
                  </>
                ) : (
                  <button
                    className="mp-slot-choose"
                    onClick={() => files.current.click()}
                    aria-label={t(`Choose photo for slot ${index + 1}`)}
                  >
                    <span className="mp-slot-number">0{index + 1}</span>
                    <Icon name="plus" />
                    <em>{t("Your ")}{t(['first', 'second', 'third'][index])}
                      <br />{t("moment")}</em>
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mp-drop-hint">{t("Drop photos here, or choose below.")}</p>
          <div className="mp-file-actions">
            <button
              className="mp-button mp-gold"
              onClick={() => files.current.click()}
            >
              <Icon name="image" />{t("Choose from gallery")}</button>
            <button
              className="mp-button mp-outline"
              onClick={() => camera.current.click()}
              title={t("On supported phones, opens the rear camera. Desktop browsers may show a file chooser.")}
            >
              <Icon name="camera" />{t("Take a photo")}</button>
          </div>
          <p className="mp-file-help">{t("JPG, PNG or WebP · Up to 5 MB each")}</p>
        </div>
        <input
          ref={files}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={event => {
            addFiles([...event.target.files]);
            event.target.value = '';
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={event => {
            addFiles([...event.target.files]);
            event.target.value = '';
          }}
        />
        <p className="mp-error" role="alert">
          {t(error)}
        </p>
        <div className="mp-review-explanation">
          <Icon name="clock" />
          <p>
            <strong>{t("A little care before we share.")}</strong>{t("In the live experience, photos are reviewed before appearing on the wall. Three active photos may be pending or approved at one time; rejected photos release their slot.")}</p>
        </div>
        <button
          className="mp-button mp-gold mp-submit"
          disabled={!selected.length}
          onClick={() => setPreviewed(true)}
        >{t("Preview submission ")}<Icon name="arrow" />
        </button>
        <div className="mp-preview-result" role="status">
          {previewed && (
            <>{t("✦ Your ")}{t(selected.length === 1 ? 'photo is' : 'photos are')}{t(" ready in this preview. Nothing was sent.")}{' '}
              <a href="#my-memories-demo">{t("Explore sample review states →")}</a>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function MemoryPhotoDemo({ tab, api, demo = false, onRequireLogin }) {
  const t = useT();
  const [activeTab, setActiveTab] = useState(tab);
  const [liked, setLiked] = useState(new Set());
  const [viewer, setViewer] = useState(null);
  const main = useRef(null);

  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);

  const currentTab = activeTab || tab;
  const liveUpload = currentTab === 'upload' && !demo;
  const liveAll = currentTab === 'all' && !demo;
  const liveMine = currentTab === 'mine' && !demo;

  useEffect(() => {
    setViewer(null);
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [currentTab, demo]);

  const toggleLike = id =>
    setLiked(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mp-demo">
      <FestivalMotion key={`${currentTab}-${demo}`} />
      <a
        className="mp-skip"
        href="#mp-content"
        onClick={event => {
          event.preventDefault();
          main.current.focus();
        }}
      >{t("Skip to memories")}</a>
      <div className="mp-sparkles" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} style={{ '--i': index }}>
            ✦
          </span>
        ))}
      </div>

      <main className="mp-main" id="mp-content" ref={main} tabIndex="-1">
        <div className="mp-topline">
          <a className="mp-wordmark" href="#memory-gallery">
            <span>✦</span>{t(" Memory Photo")}</a>
          <nav className="mp-tabs" aria-label={t("Memory Photo pages")}>
            {MEMORY_TABS.map(item => (
              <a
                href={
                  demo && item.id === 'upload'
                    ? '#memory-upload-demo'
                    : demo && item.id === 'all'
                      ? '#memory-gallery-demo'
                      : item.id === 'mine' && demo
                        ? '#my-memories-demo'
                        : item.hash
                }
                key={item.id}
                aria-current={currentTab === item.id ? 'page' : undefined}
                onClick={() => setActiveTab(item.id)}
              >
                {t(item.label)}
              </a>
            ))}
          </nav>
        </div>

        <div className="mp-demo-note">
          <span className="mp-live-dot" />
          {t(liveAll
            ? 'THE COLLEGE KEEPSAKE'
            : liveMine
              ? 'YOUR MEMORIES'
              : liveUpload
                ? 'YOUR LITTLE LIGHTS'
                : 'DESIGN PREVIEW')}
          <span>
            {t(liveAll
              ? 'Approved memories from our festival'
              : liveMine
                ? 'Your private submission history · only approved photos are public'
                : liveUpload
                  ? 'Student submissions · reviewed before sharing'
                  : 'Local demo photographs & interactions · no real uploads')}
          </span>
        </div>

        {liveAll ? (
          <AllMemories api={api} onRequireLogin={onRequireLogin} />
        ) : currentTab === 'all' ? (
          <>
            <section className="mp-hero">
              <div className="mp-hero-copy">
                <p className="mp-eyebrow">{t("✦ GUSTO COLLEGE · THADINGYUT 2026")}</p>
                <h1>{t("Our day,")}<br />{t("in ")}<em>{t("lights.")}</em>
                </h1>
                <p className="mp-lead">{t("Little moments.")}<br />{t("Beautifully remembered.")}</p>
                <a className="mp-button mp-gold" href="#memory-upload-demo">
                  <Icon name="camera" />{t("Share your memory")}</a>
                <span className="mp-signature">{t("a little light, a little us ↗")}</span>
              </div>
              <div className="mp-hero-art">
                <div className="mp-arch">
                  <img
                    src={A + 'campus-lanterns.png'}
                    alt={t("Illustrative students preparing paper lanterns; demo photograph")}
                    width="1672"
                    height="941"
                  />
                </div>
                <div className="mp-seal" aria-hidden="true">
                  <span>{t("GUSTO COLLEGE")}</span>
                  <b>{t("Made of")}<br />
                    <em>{t("memories.")}</em>
                  </b>
                  <small>✦ 2026 ✦</small>
                </div>
                <span className="mp-arch-caption" aria-hidden="true">{t("a day to keep.")}</span>
                <span className="mp-photo-credit">{t("Illustrative campus photography")}</span>
              </div>
              <img
                className="mp-hanging-lantern"
                src={A + 'memory-keepsake-lantern.svg'}
                alt=""
              />
            </section>

            <section className="mp-wall" aria-labelledby="mp-wall-title">
              <div className="mp-section-heading">
                <div>
                  <p className="mp-eyebrow">{t("THE COLLEGE KEEPSAKE")}</p>
                  <h2 id="mp-wall-title">{t("Through ")}<em>{t("our eyes.")}</em>
                  </h2>
                </div>
                <span className="mp-album-mark">{t("Our people. Our little traditions.")}<small>{t("GUSTO · 2026")}</small>
                </span>
              </div>
              <div className="mp-grid">
                {DEMO_PHOTOS.slice(0, 2).map((photo, index) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    index={index}
                    liked={liked.has(photo.id)}
                    onLike={toggleLike}
                    onView={setViewer}
                  />
                ))}
                <aside className="mp-invitation">
                  <img src={A + 'memory-keepsake-lantern.svg'} alt="" />
                  <div>
                    <p className="mp-eyebrow">{t("LEAVE A LITTLE LIGHT")}</p>
                    <h3>{t("One day.")}<br />
                      <em>{t("So much to keep.")}</em>
                    </h3>
                    <a href="#memory-upload-demo">{t("Add your memory ")}<Icon name="arrow" />
                    </a>
                    <small>{t("From our college, with love.")}</small>
                  </div>
                </aside>
                <PhotoCard
                  photo={DEMO_PHOTOS[2]}
                  index={2}
                  liked={liked.has(DEMO_PHOTOS[2].id)}
                  onLike={toggleLike}
                  onView={setViewer}
                />
              </div>
            </section>
          </>
        ) : liveMine ? (
          <MyMemories api={api} />
        ) : currentTab === 'mine' ? (
          <section className="mp-my-page" aria-labelledby="mp-my-title">
            <div className="mp-my-heading">
              <p className="mp-eyebrow">{t("YOUR LITTLE COLLECTION · SAMPLE REVIEW STATES")}</p>
              <h1 id="mp-my-title">{t("Some moments.")}<br />
                <em>{t("Just yours.")}</em>
              </h1>
              <p>{t("Opened, sealed, or kept close. A little care goes into every memory.")}</p>
            </div>
            <div className="mp-my-grid">
              <PhotoCard
                photo={DEMO_PHOTOS[0]}
                index={0}
                liked={liked.has('demo-1')}
                onLike={toggleLike}
                onView={setViewer}
                personal
              />
              <ReviewEnvelope />
              <ReviewEnvelope rejected />
            </div>
            <p className="mp-small-note">{t("These three examples demonstrate review states, not your real account or submission history. ")}<a href="#my-memories">{t("View my real submissions →")}</a>
            </p>
          </section>
        ) : liveUpload ? (
          <ConnectedUpload api={api} />
        ) : (
          <UploadStudio />
        )}

        <div className="mp-endmark" aria-hidden="true">
          <span />✦ <em>{t("the moments make us")}</em> ✦<span />
        </div>
      </main>

      <footer className="mp-footer">
        <span>{t("GUSTO College · Thadingyut 2026")}</span>
        <span>{t("Made of light. Made of us.")}</span>
        <small>
          {t(liveAll
            ? 'Approved festival memories · Original design & artwork preserved'
            : liveMine
              ? 'Student submission history · Original design & artwork preserved'
              : liveUpload
                ? 'Student submissions · Original design & artwork preserved'
                : 'Demo content only · Original design & artwork preserved')}
        </small>
      </footer>

      {viewer && !liveMine && !liveAll && (
        <Dialog
          title={t("A little closer.")}
          className="mp-viewer"
          onClose={() => setViewer(null)}
        >
          <img src={A + viewer.image} alt={t(viewer.alt)} />
          <div className="mp-viewer-bottom">
            <span>{t("Demo photograph · ")}{t(viewer.date)}</span>
            <button
              className={`mp-heart ${liked.has(viewer.id) ? 'is-liked' : ''}`}
              aria-label={t(`${liked.has(viewer.id) ? 'Unlike' : 'Like'} enlarged demo photo`)}
              aria-pressed={liked.has(viewer.id)}
              onClick={() => toggleLike(viewer.id)}
            >
              <Icon name="heart" />
              {viewer.likes + (liked.has(viewer.id) ? 1 : 0)}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
