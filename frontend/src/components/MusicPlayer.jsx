import { useEffect, useRef, useState } from 'react';

const tracks = [
  { title: 'A Town with an Ocean View', src: '/music/town-with-an-ocean-view.mp3' },
  { title: 'Merry-Go-Round of Life (Piano)', src: '/music/merry-go-round-of-life-piano.mp3' },
  { title: 'Gintama, but it’s lofi', src: '/music/gintama-lofi.mp3' },
  { title: 'Isabella’s Lullaby (Guitar)', src: '/music/isabellas-lullaby-guitar.mp3' },
];
const equalizerHeights = [7, 12, 17, 9, 19, 13, 8, 16, 20, 10, 15, 7];

export default function MusicPlayer() {
  const audioRef = useRef(null);
  const wantsPlayback = useRef(true);
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.55);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const track = tracks[trackIndex];

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  function play() {
    const audio = audioRef.current;
    if (!audio) return;
    const attempt = audio.play();
    attempt?.catch(error => {
      if (error.name === 'AbortError') return;
      wantsPlayback.current = false;
    });
  }

  useEffect(() => {
    if (wantsPlayback.current) play();
  }, [trackIndex]);

  useEffect(() => () => audioRef.current?.pause(), []);

  function nextTrack() {
    wantsPlayback.current = true;
    setTrackIndex(index => (index + 1) % tracks.length);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (audio.paused) {
      wantsPlayback.current = true;
      play();
    } else {
      wantsPlayback.current = false;
      audio.pause();
    }
  }

  return <aside className="music-player" aria-label="Festival music player">
    <audio
      ref={audioRef}
      src={track.src}
      preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={nextTrack}
      onError={() => { wantsPlayback.current = false; }}
    />
    <div className="music-player-top">
      <span className={`music-player-icon ${playing ? 'is-playing' : ''}`} aria-hidden="true">
        {equalizerHeights.map((height, index) => <i key={index} style={{ height: `${height}px`, animationDelay: `${-index * 0.13}s`, animationDuration: `${0.6 + (index % 4) * 0.12}s` }}/>) }
      </span>
      <div className="music-player-controls">
        <button className="music-player-button music-player-play" type="button" onClick={togglePlayback} aria-label={playing ? 'Pause music' : 'Play music'} title={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button className="music-player-button music-player-volume" type="button" onClick={() => setVolumeOpen(open => !open)} aria-label="Adjust volume" aria-expanded={volumeOpen} title="Volume">{volume === 0 ? '🔇' : '🔊'}</button>
        <button className="music-player-button music-player-skip" type="button" onClick={nextTrack} aria-label="Skip music" title="Next track"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16l11-8L4 4Zm13 0h3v16h-3V4Z"/></svg></button>
      </div>
    </div>
    {volumeOpen && <div className="music-volume-panel"><label htmlFor="music-volume">Volume</label><input id="music-volume" type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={event => setVolume(Number(event.target.value) / 100)} aria-label="Music volume"/></div>}
  </aside>;
}
