import {
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { enterFullscreen } from "./fullscreen";
import { UnsupportedImageError, captureVideoFrame, cropCenter, looksLikeHeic, photoSize, rotatePhoto } from "./image";
import { correctionNow, trackOrientation } from "./orientation";
import { dismissInstallCard, installCardDismissed, promptInstall, storeUrlForThisPhone, useInstallMode } from "./install";
import { enqueuePhoto, retryBlocked, useQueue } from "./queue";
import type { GuestSession } from "./session";

// Minimal typings for the ImageCapture API (Chrome/Android: full-resolution stills + real flash).
interface PhotoCapabilitiesLike {
  fillLightMode?: string[];
}
interface ImageCaptureLike {
  takePhoto(settings?: { fillLightMode?: string }): Promise<Blob>;
  getPhotoCapabilities(): Promise<PhotoCapabilitiesLike>;
}
declare const ImageCapture: { new (track: MediaStreamTrack): ImageCaptureLike } | undefined;

type Facing = "environment" | "user";
/** "phone": the guest chose their phone's own camera app — no live viewfinder until they switch back. */
type CamState = "starting" | "live" | "unavailable" | "phone";

const PHONE_CAMERA_KEY = "snapshare.phoneCamera";

/** Tips dismissed for this visit only (sessionStorage can be unavailable in private modes). */
const sessionStorageGet = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const sessionStorageSet = (key: string) => {
  try {
    sessionStorage.setItem(key, "1");
  } catch {}
};

/**
 * Android may close the page while its camera app is open; the photo is then lost (the browser can't hand
 * it to a page that no longer exists). Mark when the camera opens, so the reopened page can say so.
 */
const AWAITING_KEY = "snapshare.awaitingPhoto";
const markAwaitingPhoto = (on: boolean) => {
  try {
    on ? localStorage.setItem(AWAITING_KEY, String(Date.now())) : localStorage.removeItem(AWAITING_KEY);
  } catch {}
};
const photoLostOnRestart = () => {
  try {
    const since = Number(localStorage.getItem(AWAITING_KEY));
    localStorage.removeItem(AWAITING_KEY);
    return since > 0 && Date.now() - since < 10 * 60_000;
  } catch {
    return false;
  }
};
const prefersPhoneCamera = () => {
  try {
    return localStorage.getItem(PHONE_CAMERA_KEY) === "1";
  } catch {
    return false;
  }
};

interface Props {
  session: GuestSession;
  lastThumb: string | null;
  onCaptured: (thumbUrl: string) => void;
  onOpenFeed: () => void;
}

/**
 * Guest camera. Uses a live in-browser viewfinder when the browser allows it (HTTPS),
 * and always offers the phone's own camera app + gallery upload as a fallback.
 * Capturing never waits on the network — photos go straight into the offline queue.
 */
export function Camera({ session, lastThumb, onCaptured, onOpenFeed }: Props) {
  const { event, guestToken } = session;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageCaptureRef = useRef<ImageCaptureLike | null>(null);
  const galleryBtnRef = useRef<HTMLButtonElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const liveSupported = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  // Phone camera mode sticks (across shots and reloads) until the guest switches back. Browsers return to
  // the page after every photo and a page can't reopen the camera by itself, so each shot is one tap.
  const [phoneCamera, setPhoneCamera] = useState(prefersPhoneCamera);
  const [camState, setCamState] = useState<CamState>(
    !liveSupported ? "unavailable" : phoneCamera ? "phone" : "starting",
  );
  /** Open the phone's own camera app (must be called from a tap). */
  const openPhoneCamera = () => {
    markAwaitingPhoto(true);
    cameraInputRef.current?.click();
  };
  const choosePhoneCamera = (on: boolean) => {
    try {
      on ? localStorage.setItem(PHONE_CAMERA_KEY, "1") : localStorage.removeItem(PHONE_CAMERA_KEY);
    } catch {}
    setPhoneCamera(on);
    if (on) openPhoneCamera(); // still inside the tap, so the camera may open
  };

  // Back from the phone's camera with no photo: either cancelled (page still alive — clear the mark once
  // we're visible again) or the page was restarted (the mark survives — tell the guest on load).
  useEffect(() => {
    if (photoLostOnRestart()) {
      setNotice("Your phone restarted SnapShare while the camera was open, so that photo didn't come through — please take it again");
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") setTimeout(() => markAwaitingPhoto(false), 3000);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const [facing, setFacing] = useState<Facing>("environment");
  const [flashOn, setFlashOn] = useState(false);
  const [flashSupport, setFlashSupport] = useState<"none" | "flash" | "torch">("none");
  const [showGrid, setShowGrid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flashFx, setFlashFx] = useState(0);
  const [screenFlash, setScreenFlash] = useState(false);
  const [flying, setFlying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Install offer: Android one-tap (once Chrome allows it), iPhone steps (right away).
  // "Not now" hides the card for this event and leaves a small "Install app" link.
  const installMode = useInstallMode();
  const [installCardHidden, setInstallCardHidden] = useState(() => installCardDismissed(event.slug));
  const hideInstallCard = () => {
    dismissInstallCard(event.slug);
    setInstallCardHidden(true);
  };
  const install = async () => {
    if (installMode === "store") return void (location.href = storeUrlForThisPhone()!); // native app's store page
    if (installMode !== "prompt") return setInstallCardHidden(false); // iPhone: show the steps again
    if (!(await promptInstall())) hideInstallCard();
  };

  // ─── Low light: suggest the phone's camera ──────────────────────────────────
  // Where photos are grabbed from the live video (iPhone — Safari has no still capture), dim scenes come
  // out soft and noisy; the phone's own camera has night processing. Sample a tiny frame every 2 s.
  const [lowLight, setLowLight] = useState(false);
  const lowLightDismissKey = `snapshare.lowLightTip.${event.slug}`;
  useEffect(() => {
    if (camState !== "live" || imageCaptureRef.current || sessionStorageGet(lowLightDismissKey)) return;
    const probe = document.createElement("canvas");
    probe.width = probe.height = 24;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    let darkSamples = 0;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!ctx || !video || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
      // Average brightness under ~18% for two samples in a row (4 s) — a dim reception, not a passing shadow.
      darkSamples = sum / (px.length / 4) < 45 ? darkSamples + 1 : 0;
      if (darkSamples >= 2) {
        setLowLight(true);
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [camState, lowLightDismissKey]);
  const dismissLowLight = () => {
    sessionStorageSet(lowLightDismissKey);
    setLowLight(false);
  };

  // ─── Zoom: pinch the viewfinder or tap the 1×/2× chip ──────────────────────
  // Hardware zoom (the camera's own, most Android phones) when the track supports it; otherwise digital
  // zoom — the preview is scaled and the photo cropped to match (iPhone, older Android).

  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; hardware: boolean }>({ min: 1, max: 4, hardware: false });
  const zoomRef = useRef(1);
  const zoomFrame = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const applyZoom = (value: number) => {
    const z = Math.min(zoomRange.max, Math.max(zoomRange.min, value));
    zoomRef.current = z;
    setZoom(z);
    if (!zoomRange.hardware) return;
    // Pinch fires many moves per frame: send the camera at most one zoom change per frame.
    cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = requestAnimationFrame(() => {
      void streamRef.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ zoom: zoomRef.current } as never] }).catch(() => {});
    });
  };

  const zoomPresets = [zoomRange.min < 1 ? zoomRange.min : null, 1, 2, 3].filter(
    (z): z is number => z !== null && z <= zoomRange.max,
  );
  const nextPreset = () => applyZoom(zoomPresets.find((z) => z > zoomRef.current + 0.05) ?? zoomPresets[0]!);

  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    enterFullscreen(); // returning guests land straight on the camera: their first tap hides the browser bars
    void trackOrientation(); // landscape photos (iPhone asks for motion access on this first tap)
    if (camState !== "live" || (e.target as Element).closest("button, section")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: pinchDistance(), zoom: zoomRef.current };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2 && pinch.current.dist > 0) {
      applyZoom(pinch.current.zoom * (pinchDistance() / pinch.current.dist));
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // ─── Live camera lifecycle ──────────────────────────────────────────────────

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    imageCaptureRef.current = null;
  };

  const startStream = useCallback(async () => {
    if (!liveSupported) return;
    if (phoneCamera) {
      stopStream();
      setCamState("phone");
      return;
    }
    stopStream();
    setCamState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0]!;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Detect the best available flash: real flash (ImageCapture) → torch → none.
      let support: "none" | "flash" | "torch" = "none";
      if (typeof ImageCapture !== "undefined") {
        const ic = new ImageCapture(track);
        imageCaptureRef.current = ic;
        const caps = await ic.getPhotoCapabilities().catch(() => null);
        if (caps?.fillLightMode?.includes("flash")) support = "flash";
      }
      const trackCaps = (track.getCapabilities?.() ?? {}) as { torch?: boolean; zoom?: { min: number; max: number } };
      if (support === "none" && trackCaps.torch) support = "torch";
      setFlashSupport(support);

      // New camera (start or flip): back to 1× and find out what zoom it can do.
      const hw = trackCaps.zoom && trackCaps.zoom.max > trackCaps.zoom.min ? trackCaps.zoom : null;
      const range = hw ? { min: hw.min, max: Math.min(hw.max, 10), hardware: true } : { min: 1, max: 4, hardware: false };
      setZoomRange(range);
      const start = Math.min(range.max, Math.max(range.min, 1));
      zoomRef.current = start;
      setZoom(start);
      if (hw) void track.applyConstraints({ advanced: [{ zoom: start } as never] }).catch(() => {});
      setCamState("live");
    } catch {
      setCamState("unavailable");
    }
  }, [facing, liveSupported, phoneCamera]);

  useEffect(() => {
    void startStream();
    // Release the camera when the tab is hidden; resume when it's back.
    const onVis = () => (document.visibilityState === "hidden" ? stopStream() : void startStream());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopStream();
    };
  }, [startStream]);

  // ─── Capture ────────────────────────────────────────────────────────────────

  const handlePhoto = async (blob: Blob) => {
    // Most browsers can't display HEIC: animate the converted JPEG instead (after a short decode).
    const heic = looksLikeHeic(blob);
    if (!heic) setFlying(URL.createObjectURL(blob));
    try {
      const item = await enqueuePhoto(blob, event.id, guestToken);
      if (heic) setFlying(URL.createObjectURL(item.blob));
    } catch (err) {
      navigator.vibrate?.([40, 60, 40]);
      setNotice(err instanceof UnsupportedImageError ? "That photo's format isn't supported — try another" : "Couldn't save that photo — try again");
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), Math.max(4000, notice.length * 70)); // long messages stay longer
    return () => clearTimeout(t);
  }, [notice]);

  const shoot = async () => {
    if (busy || camState !== "live" || !videoRef.current) return;
    setBusy(true);
    navigator.vibrate?.(20);
    const track = streamRef.current?.getVideoTracks()[0];
    try {
      let blob: Blob;
      if (facing === "user" && flashOn) {
        // Front camera: light the face with a white screen.
        setScreenFlash(true);
        await new Promise((r) => setTimeout(r, 220));
        blob = await captureVideoFrame(videoRef.current, true);
        setScreenFlash(false);
      } else if (imageCaptureRef.current && facing === "environment") {
        if (flashOn && flashSupport === "torch") await track?.applyConstraints({ advanced: [{ torch: true } as never] });
        blob = await imageCaptureRef.current
          .takePhoto(flashOn && flashSupport === "flash" ? { fillLightMode: "flash" } : {})
          .catch(() => captureVideoFrame(videoRef.current!, false));
        if (flashOn && flashSupport === "torch") await track?.applyConstraints({ advanced: [{ torch: false } as never] });
      } else {
        if (flashOn && flashSupport === "torch") {
          await track?.applyConstraints({ advanced: [{ torch: true } as never] });
          await new Promise((r) => setTimeout(r, 300));
        }
        blob = await captureVideoFrame(videoRef.current, facing === "user");
        if (flashOn && flashSupport === "torch") await track?.applyConstraints({ advanced: [{ torch: false } as never] });
      }
      setFlashFx((n) => n + 1);
      // Hardware zoom is already in the photo; digital zoom crops it to what the viewfinder showed.
      if (!zoomRange.hardware && zoomRef.current > 1) blob = await cropCenter(blob, zoomRef.current);
      // Phone held sideways but the frame came out portrait (rotation lock / full-res capture): turn it.
      const size = await photoSize(blob);
      blob = await rotatePhoto(blob, correctionNow(size.width, size.height));
      await handlePhoto(blob);
    } catch {
      setScreenFlash(false);
      navigator.vibrate?.([40, 60, 40]);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/") || f.type === "");
    e.target.value = "";
    markAwaitingPhoto(false); // the photo made it back
    for (const f of files) await handlePhoto(f);
  };

  // ─── Fly-to-gallery animation (Web Animations API) ──────────────────────────

  const flyRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !flying) return;
      const target = galleryBtnRef.current?.getBoundingClientRect();
      const start = img.getBoundingClientRect();
      if (!target || !start.width) {
        onCaptured(flying);
        setFlying(null);
        return;
      }
      const dx = target.left + target.width / 2 - (start.left + start.width / 2);
      const dy = target.top + target.height / 2 - (start.top + start.height / 2);
      const s = target.width / start.width;
      const anim = img.animate(
        [
          { transform: "translate(0,0) scale(1)", borderRadius: "20px", opacity: 1 },
          { transform: "translate(0,0) scale(0.84)", borderRadius: "20px", opacity: 1, offset: 0.18 },
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, borderRadius: `${12 / s}px`, opacity: 0.9 },
        ],
        { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
      anim.onfinish = () => {
        onCaptured(flying);
        setFlying(null);
      };
    },
    [flying, onCaptured],
  );

  // ─── UI ─────────────────────────────────────────────────────────────────────

  return (
    <main
      className="camera"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {lowLight && camState === "live" && (installCardHidden || !installMode) && (
        <section className="install-card lowlight" role="dialog" aria-label="Low light">
          <span className="lowlight-icon" aria-hidden>
            ☾
          </span>
          <div className="install-copy">
            <strong>It's dark here</strong>
            <span>For sharper photos in low light, use your phone's camera — it has night mode.</span>
          </div>
          <div className="install-actions">
            <button className="btn small ghost" onClick={dismissLowLight}>
              Keep this camera
            </button>
            <button
              className="btn small light"
              onClick={() => {
                dismissLowLight();
                choosePhoneCamera(true);
              }}
            >
              Use phone camera
            </button>
          </div>
        </section>
      )}
      {installMode && !installCardHidden && (
        <section className="install-card" role="dialog" aria-label="Install SnapShare">
          <img src="/join/icons/icon-192.png" alt="" width="44" height="44" />
          <div className="install-copy">
            <strong>{installMode === "store" ? "Get the SnapShare app" : "Install SnapShare"}</strong>
            {installMode === "store" && (
              <span>
                Sharper photos and a one-tap camera. Then enter code <b>{event.slug.toUpperCase()}</b> in the app.
              </span>
            )}
            {installMode === "prompt" && <span>Open {event.name} from your home screen, full screen.</span>}
            {installMode === "ios" && (
              <span>
                Tap <IconShare /> <b>Share</b> in your browser, then <b>Add to Home Screen</b> to open {event.name} full
                screen.
              </span>
            )}
            {installMode === "ios-in-app" && (
              <span>
                Open this page in <b>Safari</b> first (tap ••• then “Open in Safari”), then Share → <b>Add to Home Screen</b>.
              </span>
            )}
          </div>
          <div className="install-actions">
            {installMode === "prompt" || installMode === "store" ? (
              <>
                <button className="btn small ghost" onClick={hideInstallCard}>
                  Not now
                </button>
                <button className="btn small light" onClick={install}>
                  {installMode === "store" ? "Get the app" : "Install"}
                </button>
              </>
            ) : (
              <button className="btn small light" onClick={hideInstallCard}>
                Got it
              </button>
            )}
          </div>
        </section>
      )}
      {liveSupported && (
        <video
          ref={videoRef}
          className={`viewfinder ${facing === "user" ? "mirror" : ""} ${camState === "live" ? "on" : ""}`}
          // Digital zoom scales the preview; hardware zoom is done by the camera itself.
          style={{ "--zoom": zoomRange.hardware ? 1 : zoom } as CSSProperties}
          playsInline
          muted
          autoPlay
        />
      )}
      {camState === "live" && showGrid && <div className="grid-overlay" aria-hidden />}
      {flashFx > 0 && <div key={flashFx} className="flash-fx" aria-hidden />}
      {screenFlash && <div className="screen-flash" aria-hidden />}

      <header className="cam-top">
        {camState === "live" ? (
          <button
            className={`icon-btn ${flashOn ? "active" : ""}`}
            aria-label={`Flash ${flashOn ? "on" : "off"}`}
            disabled={facing === "environment" && flashSupport === "none"}
            onClick={() => setFlashOn((f) => !f)}
          >
            {flashOn ? <IconFlash /> : <IconFlashOff />}
          </button>
        ) : (
          <span className="icon-spacer" />
        )}
        <span className="event-title">{event.name}</span>
        {camState === "live" ? (
          <button className={`icon-btn ${showGrid ? "active" : ""}`} aria-label="Toggle grid" onClick={() => setShowGrid((g) => !g)}>
            <IconGrid />
          </button>
        ) : (
          <span className="icon-spacer" />
        )}
      </header>

      {(camState === "unavailable" || camState === "phone") && (
        <section
          className={`fallback ${camState === "phone" ? "tap-anywhere" : ""}`}
          // Phone camera mode: the whole screen is the shutter. Browsers only open the camera from a tap,
          // so after each photo this is the closest to "straight back into the camera".
          onClick={camState === "phone" ? (e) => !(e.target as Element).closest("button") && openPhoneCamera() : undefined}
        >
          <p className="kicker">{camState === "phone" ? "Phone camera" : "Share the moment"}</p>
          <h2>{camState === "phone" ? "Tap anywhere for the next photo" : `Take photos for ${event.name}`}</h2>
          <p className="muted">
            {camState === "phone"
              ? "Your phone's camera opens, and every photo uploads on its own."
              : "They'll appear live on the big screen and in the gallery."}
          </p>
          <button className="btn primary big" onClick={openPhoneCamera}>
            <IconCamera /> Take a photo
          </button>
          <button className="btn ghost" onClick={() => uploadInputRef.current?.click()}>
            Choose from my photos
          </button>
          {camState === "phone" && (
            <button className="btn ghost small" onClick={() => choosePhoneCamera(false)}>
              Switch to the SnapShare camera
            </button>
          )}
          {installMode && installCardHidden && (
            <button className="btn ghost small" onClick={install}>
              {installMode === "store" ? "Get the SnapShare app" : "Install the SnapShare app"}
            </button>
          )}
          {camState === "unavailable" && liveSupported && (
            <p className="fineprint">Allow camera access in your browser settings to use the in-app camera.</p>
          )}
        </section>
      )}

      <footer className="cam-bottom">
        {notice ? (
          <div className="pill warn" role="alert">
            {notice}
          </div>
        ) : (
          <StatusPill eventId={event.id} guestToken={guestToken} />
        )}
        {camState === "live" && (
          <button className="zoom-chip" aria-label={`Zoom ${formatZoom(zoom)}, tap to change`} onClick={nextPreset}>
            {formatZoom(zoom)}
          </button>
        )}
        <div className="controls">
          <button ref={galleryBtnRef} className="gallery-btn" aria-label="Open live gallery" onClick={onOpenFeed}>
            {lastThumb ? <img src={lastThumb} alt="" /> : <IconImages />}
            <PendingBadge eventId={event.id} />
          </button>

          {camState === "unavailable" || camState === "phone" ? (
            <button className="shutter alt" aria-label="Take a photo" onClick={openPhoneCamera}>
              <IconCamera />
            </button>
          ) : (
            <button className="shutter" aria-label="Take photo" disabled={camState !== "live" || busy} onClick={shoot}>
              <span />
            </button>
          )}

          {camState === "live" ? (
            <button
              className="icon-btn big"
              aria-label="Flip camera"
              onClick={() => {
                setFlashOn(false);
                setFacing((f) => (f === "environment" ? "user" : "environment"));
              }}
            >
              <IconFlip />
            </button>
          ) : (
            <button className="icon-btn big" aria-label="Upload from my photos" onClick={() => uploadInputRef.current?.click()}>
              <IconUpload />
            </button>
          )}
        </div>
        {camState === "live" && (
          <div className="alt-actions">
            <button onClick={() => choosePhoneCamera(true)}>Use phone camera</button>
            <span aria-hidden>·</span>
            <button onClick={() => uploadInputRef.current?.click()}>Upload from photos</button>
            {installMode && installCardHidden && (
              <>
                <span aria-hidden>·</span>
                <button onClick={install}>{installMode === "store" ? "Get the app" : "Install app"}</button>
              </>
            )}
          </div>
        )}
      </footer>

      {flying && <img ref={flyRef} src={flying} className="fly" alt="" />}

      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
      <input ref={uploadInputRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    </main>
  );
}

// ─── Upload status ──────────────────────────────────────────────────────────

function StatusPill({ eventId, guestToken }: { eventId: string; guestToken: string }) {
  const q = useQueue();
  const [, tick] = useState(0);
  const mine = q.items.filter((i) => i.eventId === eventId);
  const blocked = mine.filter((i) => i.status === "blocked").length;
  const pending = mine.length - blocked;
  const justDone = Date.now() - q.lastCompletedAt < 2500;

  // Re-render once the "✓ Uploaded" window passes so the pill hides itself.
  useEffect(() => {
    if (!justDone) return;
    const t = setTimeout(() => tick((n) => n + 1), 2600);
    return () => clearTimeout(t);
  }, [justDone, q.lastCompletedAt]);

  const plural = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;
  if (blocked)
    return (
      <button className="pill warn" onClick={() => retryBlocked(eventId, guestToken)}>
        {plural(blocked)} couldn't upload · Tap to retry
      </button>
    );
  if (pending && !q.online) return <div className="pill">Offline · {plural(pending)} saved, will upload automatically</div>;
  if (pending)
    return (
      <div className="pill">
        <span className="spinner" /> Uploading {plural(pending)}…
      </div>
    );
  if (justDone) return <div className="pill ok">✓ Uploaded</div>;
  return <div className="pill hidden" aria-hidden />;
}

function PendingBadge({ eventId }: { eventId: string }) {
  const n = useQueue().items.filter((i) => i.eventId === eventId && i.status !== "blocked").length;
  return n ? <span className="badge">{n}</span> : null;
}

// ─── Icons (inline SVG, inherit currentColor) ───────────────────────────────

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const IconFlash = () => (
  <Svg>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
  </Svg>
);
const IconFlashOff = () => (
  <Svg>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    <path d="M3 3l18 18" />
  </Svg>
);
const IconGrid = () => (
  <Svg>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </Svg>
);
const IconImages = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m21 16-5-5-8 8" />
  </Svg>
);
const IconFlip = () => (
  <Svg>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 3v5h5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 21v-5h-5" />
  </Svg>
);
const IconCamera = () => (
  <Svg>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Svg>
);
/** "1×", "2.4×", "0.5×" — like the system camera's zoom label. */
const formatZoom = (z: number) => `${z < 1 ? z.toFixed(1) : Math.round(z * 10) / 10}×`;

/** Safari's Share icon, so the install steps match what the guest sees. */
const IconShare = () => (
  <Svg>
    <path d="M12 15V3M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </Svg>
);
const IconUpload = () => (
  <Svg>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </Svg>
);
