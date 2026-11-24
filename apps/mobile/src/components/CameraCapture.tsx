import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Camera } from "lucide-react";
import { AdaptiveTaskSurface } from "./AdaptiveTaskSurface";
import "./CameraCapture.css";

type CameraStatus = "opening" | "live" | "blocked" | "missing" | "unsupported" | "failed";

/** One video input the browser reports once permission has been granted. */
interface CameraDevice {
  id: string;
  label: string;
}

export interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** The bounded capture handed to the caller's existing photo pipeline. */
  onCapture: (file: File) => void;
  /** Opens the normal gallery picker; the camera stays a camera, never a relabelled file dialog. */
  onChoosePhoto?: () => void;
}

function statusCopy(status: CameraStatus): string {
  switch (status) {
    case "blocked": return "Camera access is blocked. Allow camera access in your browser, or choose a photo instead.";
    case "missing": return "No camera was found on this device. Choose a photo instead.";
    case "unsupported": return "This browser can't open the camera here. Choose a photo instead.";
    case "failed": return "The camera couldn't start. Try again, or choose a photo instead.";
    case "opening": return "Starting camera…";
    case "live": return "";
  }
}

function failureStatus(error: unknown): CameraStatus {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  return "failed";
}

/** A readable name for one video input; the browser's own label when allowed. */
function cameraLabel(device: MediaDeviceInfo, index: number): string {
  const label = device.label.trim();
  if (label === "") return `Camera ${index + 1}`;
  // Chrome appends the USB/vendor id in parentheses; it is noise in a picker
  // and the useful part is the product name before it.
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim() || `Camera ${index + 1}`;
}

/**
 * One real camera surface for the web build.
 *
 * The Android build already captures through the native media plugin; this
 * dialog exists for every other runtime, where a `capture` file input is just
 * a gallery picker on a desktop browser. It opens the actual camera, shows the
 * live preview and hands a JPEG File to the surface's existing photo
 * preparation path.
 *
 * Every camera the device exposes is reachable,
 * not only a front/rear pair. After permission is granted the browser labels
 * its video inputs, and each one becomes a selectable control; a device with
 * one camera shows no selector at all. Mirroring follows the track's own
 * facing mode, so a laptop webcam is never flipped while a selfie camera is.
 */
export function CameraCapture({ open, onClose, onCapture, onChoosePhoto }: CameraCaptureProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const run = useRef(0);
  const shotUrl = useRef<string | null>(null);
  /** Settings of the live track, read at capture time (never during render). */
  const mirrored = useRef(false);
  const [status, setStatus] = useState<CameraStatus>("opening");
  const [cams, setCams] = useState<CameraDevice[]>([]);
  const [activeCam, setActiveCam] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    const current = stream.current;
    stream.current = null;
    if (current) for (const track of current.getTracks()) track.stop();
    if (video.current) video.current.srcObject = null;
  }, []);

  const releaseShot = useCallback(() => {
    if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
    shotUrl.current = null;
  }, []);

  const start = useCallback(async (pick: { deviceId?: string; facing?: "environment" | "user" } = {}) => {
    const id = ++run.current;
    stopStream();
    releaseShot();
    setShot(null);
    setStatus("opening");
    setReady(false);
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    try {
      const next = await media.getUserMedia({
        audio: false,
        video: {
          ...(pick.deviceId ? { deviceId: { exact: pick.deviceId } } : { facingMode: pick.facing ?? "environment" }),
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      if (run.current !== id) {
        for (const track of next.getTracks()) track.stop();
        return;
      }
      stream.current = next;
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play().catch(() => undefined);
      }
      if (run.current !== id) return;
      const track = next.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      mirrored.current = settings.facingMode === "user";
      setMirror(mirrored.current);
      setActiveCam(settings.deviceId || pick.deviceId || null);
      setStatus("live");
      // Labels are blank before permission, so the list is read here and not
      // on mount. One failure is not a camera failure: capture already works.
      try {
        const devices = await media.enumerateDevices();
        if (run.current !== id) return;
        setCams(devices
          .filter((device) => device.kind === "videoinput")
          .map((device, index) => ({ id: device.deviceId, label: cameraLabel(device, index) })));
      } catch {
        // Device labels are a nice-to-have; capture already works.
      }
    } catch (error) {
      if (run.current === id) setStatus(failureStatus(error));
    }
  }, [releaseShot, stopStream]);

  useEffect(() => {
    if (!open) {
      run.current += 1;
      stopStream();
      releaseShot();
      setShot(null);
      return;
    }
    void start({ facing: "environment" });
    return () => {
      run.current += 1;
      stopStream();
    };
  }, [open, releaseShot, start, stopStream]);

  useEffect(() => () => {
    run.current += 1;
    stopStream();
    releaseShot();
  }, [releaseShot, stopStream]);

  function close() {
    run.current += 1;
    stopStream();
    releaseShot();
    setShot(null);
    onClose();
  }

  function capture() {
    const element = video.current;
    if (!element || element.videoWidth <= 0 || element.videoHeight <= 0 || capturing) return;
    const id = run.current;
    setCapturing(true);
    const width = element.videoWidth;
    const height = element.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setCapturing(false);
      setStatus("failed");
      return;
    }
    if (mirrored.current) {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(element, 0, 0, width, height);
    canvas.toBlob((blob) => {
      setCapturing(false);
      if (run.current !== id) return;
      if (!blob) {
        setStatus("failed");
        return;
      }
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      releaseShot();
      shotUrl.current = url;
      setShot({ file, url });
      // The review still is the subject now; turn the camera off until Retake.
      run.current += 1;
      stopStream();
    }, "image/jpeg", 0.92);
  }

  function retake() {
    releaseShot();
    setShot(null);
    void start(activeCam ? { deviceId: activeCam } : { facing: "environment" });
  }

  function useShot() {
    if (!shot) return;
    const file = shot.file;
    onCapture(file);
    close();
  }

  function choosePhoto() {
    close();
    onChoosePhoto?.();
  }

  const unavailable = status !== "live" && status !== "opening";
  const footer = shot ? <>
    <Button className="fb-surface-button" onPress={retake}>Retake</Button>
    <Button className="fb-surface-button fb-confirm-primary" onPress={useShot}>Use photo</Button>
  </> : <>
    {onChoosePhoto && <Button className="fb-surface-button" onPress={choosePhoto}>Choose photo</Button>}
    {status === "opening"
      ? <Button className="fb-surface-button fb-confirm-primary" isDisabled>Starting…</Button>
      : unavailable
        ? <Button className="fb-surface-button fb-confirm-primary" onPress={() => void start({ facing: "environment" })}>Try again</Button>
        : <Button className="fb-surface-button fb-confirm-primary fb-camera-take" onPress={capture} isDisabled={capturing || !ready}>
            <Camera size={18} aria-hidden="true" /> Take photo
          </Button>}
  </>;

  return <AdaptiveTaskSurface open={open} onClose={close} title="Take photo" width="standard"
    bodyClassName="fb-camera-body" footer={footer}>
    <div className="fb-camera-stage">
      <video ref={video} className="fb-camera-video" data-mirror={mirror ? "true" : undefined}
        data-hidden={shot ? "true" : undefined} autoPlay muted playsInline aria-label="Camera preview"
        onLoadedMetadata={() => setReady(true)} />
      {shot && <img src={shot.url} alt="Captured photo" data-mirror={mirror ? "true" : undefined} />}
      {(status === "opening" || unavailable) && <p className="fb-camera-status" role="status">{statusCopy(status)}</p>}
    </div>
    {status === "live" && !shot && cams.length > 1 && (
      <div className="fb-camera-cams" role="group" aria-label="Choose a camera">
        {cams.map((cam) => (
          <button key={cam.id} type="button" className="fb-camera-cam"
            aria-pressed={cam.id === activeCam}
            onClick={() => { if (cam.id !== activeCam) void start({ deviceId: cam.id }); }}>
            <span>{cam.label}</span>
          </button>
        ))}
      </div>
    )}
  </AdaptiveTaskSurface>;
}
