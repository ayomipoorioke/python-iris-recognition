export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is unavailable in this browser. Choose an image instead.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  try {
    video.srcObject = stream;
    await video.play();
    return stream;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    throw error;
  }
}

export async function captureEyeImage(video) {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("The camera is still starting. Wait a moment and try again.");
  }
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const crop = {
    x: Math.round(sourceWidth * 0.15),
    y: Math.round(sourceHeight * 0.28),
    width: Math.round(sourceWidth * 0.70),
    height: Math.round(sourceHeight * 0.44),
  };
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The camera image could not be prepared. Try again.");
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The camera image could not be prepared. Try again."));
      canvas.width = 0;
      canvas.height = 0;
    }, "image/jpeg", 0.92);
  });
}

export function stopCamera(video) {
  const stream = video?.srcObject;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (video) video.srcObject = null;
}

export function clearImagePreview(image, url) {
  if (url) URL.revokeObjectURL(url);
  if (image) image.removeAttribute("src");
}