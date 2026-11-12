import {
  deleteRegistration,
  enrollImage,
  hashAccountIdentifier,
  hasApiToken,
  setApiToken,
  verifyImage,
} from "./api.js";
import { captureEyeImage, clearImagePreview, startCamera, stopCamera } from "./camera.js";

const views = [...document.querySelectorAll("[data-view]")];
const globalStatus = document.querySelector("#global-status");
const tokenInput = document.querySelector("#api-token");
const tokenStatus = document.querySelector("#token-status");

let registrationSubjectId = "";
let registrationImage = null;
let registrationStream = null;
let registrationPreviewUrl = "";
let verificationStream = null;
let verificationImage = null;
let verificationPreviewUrl = "";
let registrationBusy = false;
let verificationBusy = false;

function announce(message) {
  globalStatus.textContent = message;
}

function setMessage(element, message, kind = "") {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("message-error", kind === "error");
  element.classList.toggle("message-success", kind === "success");
}

function busyButton(button, busy, label) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.innerHTML = busy ? `<span class="loading-mark" aria-hidden="true"></span>${label}` : label;
}

function resetRegistration() {
  registrationSubjectId = "";
  registrationImage = null;
  registrationBusy = false;
  stopCamera(document.querySelector("#register-video"));
  registrationStream = null;
  clearImagePreview(document.querySelector("#register-image-preview"), registrationPreviewUrl);
  registrationPreviewUrl = "";
  document.querySelector("#register-image-preview").hidden = true;
  document.querySelector("#register-file").value = "";
  document.querySelector("#register-video").hidden = false;
  document.querySelector("#register-camera-placeholder").hidden = false;
  document.querySelector("#register-identifier").value = "";
  document.querySelector("#consent-check").checked = false;
  document.querySelectorAll(".register-stage").forEach((stage) => { stage.hidden = true; });
  document.querySelector("#register-complete").hidden = true;
  document.querySelector("#register-stage-1").hidden = false;
  document.querySelector("#register-step-number").textContent = "1";
  document.querySelector("#continue-register").disabled = false;
  document.querySelector("#register-scan").disabled = true;
  document.querySelector("#register-scan").textContent = "Start scan";
  setMessage(document.querySelector("#register-input-error"), "");
  setMessage(document.querySelector("#register-scan-error"), "");
  setMessage(document.querySelector("#register-confirm-error"), "");
}

function resetVerification() {
  verificationBusy = false;
  verificationImage = null;
  stopCamera(document.querySelector("#verify-video"));
  verificationStream = null;
  clearImagePreview(document.querySelector("#verify-image-preview"), verificationPreviewUrl);
  verificationPreviewUrl = "";
  document.querySelector("#verify-image-preview").hidden = true;
  document.querySelector("#verify-file").value = "";
  document.querySelector("#verify-video").hidden = false;
  document.querySelector("#verify-camera-placeholder").hidden = false;
  document.querySelector("#verify-identifier").value = "";
  document.querySelector("#verify-video").hidden = false;
  document.querySelector("#verify-camera-placeholder").hidden = false;
  document.querySelector("#verify-start").disabled = true;
  document.querySelector("#verify-start").textContent = "Verify me";
  document.querySelector("#verify-result").hidden = true;
  setMessage(document.querySelector("#verify-error"), "");
  setMessage(document.querySelector("#verify-status"), "Your preview is ready when the camera is on.");
}

function openView(name) {
  if ((name === "register" || name === "verify") && !hasApiToken()) {
    name = "help";
    setMessage(tokenStatus, "Enter the local access key from PowerShell to continue.", "error");
  }
  stopCamera(document.querySelector("#register-video"));
  registrationStream = null;
  stopCamera(document.querySelector("#verify-video"));
  verificationStream = null;
  if (name !== "register") {
    registrationImage = null;
    registrationSubjectId = "";
    clearImagePreview(document.querySelector("#register-image-preview"), registrationPreviewUrl);
    registrationPreviewUrl = "";
    document.querySelector("#register-image-preview").hidden = true;
    document.querySelector("#register-file").value = "";
    document.querySelector("#register-identifier").value = "";
  }
  if (name !== "verify") {
    verificationImage = null;
    clearImagePreview(document.querySelector("#verify-image-preview"), verificationPreviewUrl);
    verificationPreviewUrl = "";
    document.querySelector("#verify-image-preview").hidden = true;
    document.querySelector("#verify-file").value = "";
    document.querySelector("#verify-identifier").value = "";
  }
  if (name === "register") resetRegistration();
  if (name === "verify") resetVerification();
  for (const view of views) {
    view.hidden = view.dataset.view !== name;
  }
  const heading = document.querySelector(`#screen-${name} h1`);
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
  announce(`${name === "help" ? "Settings and help" : name === "home" ? "Welcome" : name} screen`);
  if (name === "verify") prepareVerificationCamera();
}

document.querySelectorAll("[data-screen]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openView(button.dataset.screen);
  });
});

document.querySelectorAll('.file-link[role="button"]').forEach((button) => {
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      button.click();
    }
  });
});

document.querySelector("#save-token").addEventListener("click", () => {
  const value = tokenInput.value.trim();
  if (!value) {
    setMessage(tokenStatus, "Enter the access key shown in the PowerShell terminal.", "error");
    tokenInput.focus();
    return;
  }
  setApiToken(value);
  tokenInput.value = "";
  setMessage(tokenStatus, "Access key is ready for this tab. It is not saved when you close it.", "success");
  announce("Local access key set for this tab");
});

document.querySelector("#continue-register").addEventListener("click", async () => {
  const identifier = document.querySelector("#register-identifier").value;
  const error = document.querySelector("#register-input-error");
  try {
    if (!document.querySelector("#consent-check").checked) {
      throw new Error("Please confirm informed consent before continuing.");
    }
    registrationSubjectId = await hashAccountIdentifier(identifier);
    document.querySelector("#register-stage-1").hidden = true;
    document.querySelector("#register-stage-2").hidden = false;
    document.querySelector("#register-step-number").textContent = "2";
    setMessage(error, "");
    document.querySelector("#register-camera-placeholder").hidden = false;
    document.querySelector("#register-video").hidden = false;
    prepareRegistrationCamera();
  } catch (problem) {
    setMessage(error, problem.message, "error");
  }
});

async function prepareRegistrationCamera() {
  const status = document.querySelector("#register-scan-status");
  const video = document.querySelector("#register-video");
  try {
    registrationStream = await startCamera(video);
    document.querySelector("#register-camera-placeholder").hidden = true;
    document.querySelector("#register-scan").disabled = false;
    setMessage(status, "Ready. Position one eye inside the guide.");
  } catch (problem) {
    setMessage(status, "Camera isn’t available. You can choose an image instead.");
    setMessage(document.querySelector("#register-scan-error"), problem.message, "error");
  }
}

function selectedFileError(file) {
  if (file.size > 5 * 1024 * 1024) return "Choose an image under 5 MB.";
  const allowed = ["image/jpeg", "image/png", "image/bmp"];
  if (file.type && !allowed.includes(file.type)) return "Choose a BMP, JPEG, or PNG image.";
  return "";
}

function showImagePreview(blob, imageElement, videoElement, placeholder, guide, currentUrl) {
  clearImagePreview(imageElement, currentUrl);
  const url = URL.createObjectURL(blob);
  imageElement.src = url;
  imageElement.hidden = false;
  videoElement.hidden = true;
  placeholder.hidden = true;
  guide.hidden = true;
  return url;
}

document.querySelector("#register-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const fileError = selectedFileError(file);
  if (fileError) {
    event.target.value = "";
    setMessage(document.querySelector("#register-scan-error"), fileError, "error");
    return;
  }
  registrationImage = file;
  stopCamera(document.querySelector("#register-video"));
  registrationStream = null;
  registrationPreviewUrl = showImagePreview(
    file,
    document.querySelector("#register-image-preview"),
    document.querySelector("#register-video"),
    document.querySelector("#register-camera-placeholder"),
    document.querySelector("#screen-register .eye-guide"),
    registrationPreviewUrl,
  );
  document.querySelector("#register-scan").disabled = false;
  document.querySelector("#register-scan").textContent = "Use this image";
  setMessage(document.querySelector("#register-scan-status"), "Image selected. Continue when you’re ready.");
  setMessage(document.querySelector("#register-scan-error"), "");
});

document.querySelector("#register-scan").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const status = document.querySelector("#register-scan-status");
  if (button.disabled || registrationBusy) return;
  registrationBusy = true;
  busyButton(button, true, "Scanning…");
  setMessage(document.querySelector("#register-scan-error"), "");
  setMessage(status, "Scanning. Keep still for a moment.");
  try {
    if (!registrationImage) {
      registrationImage = await captureEyeImage(document.querySelector("#register-video"));
    }
    stopCamera(document.querySelector("#register-video"));
    registrationStream = null;
    registrationPreviewUrl = showImagePreview(
      registrationImage,
      document.querySelector("#register-image-preview"),
      document.querySelector("#register-video"),
      document.querySelector("#register-camera-placeholder"),
      document.querySelector("#screen-register .eye-guide"),
      registrationPreviewUrl,
    );
    document.querySelector("#register-stage-2").hidden = true;
    document.querySelector("#register-stage-3").hidden = false;
    document.querySelector("#register-step-number").textContent = "3";
    document.querySelector("#save-registration").disabled = false;
    setMessage(document.querySelector("#register-confirm-status"), "Scan successful. Confirm to save your registration.", "success");
    document.querySelector("#save-registration").focus();
  } catch (problem) {
    registrationImage = null;
    setMessage(document.querySelector("#register-scan-error"), problem.message || "Scan failed. Try again.", "error");
    setMessage(status, "Scan failed. Check the guidance and try again.", "error");
    button.textContent = "Try again";
  } finally {
    registrationBusy = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});

document.querySelector("#back-to-register-info").addEventListener("click", () => {
  stopCamera(document.querySelector("#register-video"));
  registrationStream = null;
  registrationImage = null;
  clearImagePreview(document.querySelector("#register-image-preview"), registrationPreviewUrl);
  registrationPreviewUrl = "";
  document.querySelector("#register-image-preview").hidden = true;
  document.querySelector("#register-file").value = "";
  document.querySelector("#register-stage-2").hidden = true;
  document.querySelector("#register-stage-1").hidden = false;
  document.querySelector("#register-step-number").textContent = "1";
});

document.querySelector("#retake-registration").addEventListener("click", async () => {
  registrationImage = null;
  clearImagePreview(document.querySelector("#register-image-preview"), registrationPreviewUrl);
  registrationPreviewUrl = "";
  document.querySelector("#register-image-preview").hidden = true;
  document.querySelector("#register-file").value = "";
  document.querySelector("#register-stage-3").hidden = true;
  document.querySelector("#register-stage-2").hidden = false;
  document.querySelector("#register-video").hidden = false;
  document.querySelector("#register-camera-placeholder").hidden = false;
  document.querySelector("#register-scan").textContent = "Start scan";
  document.querySelector("#register-scan").disabled = true;
  await prepareRegistrationCamera();
});

document.querySelector("#save-registration").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled || registrationBusy) return;
  registrationBusy = true;
  busyButton(button, true, "Saving…");
  setMessage(document.querySelector("#register-confirm-error"), "");
  try {
    await enrollImage(registrationSubjectId, registrationImage);
    registrationImage = null;
    registrationSubjectId = "";
    clearImagePreview(document.querySelector("#register-image-preview"), registrationPreviewUrl);
    registrationPreviewUrl = "";
    document.querySelector("#register-image-preview").hidden = true;
    document.querySelector("#register-file").value = "";
    document.querySelector("#register-stage-3").hidden = true;
    document.querySelector("#register-complete").hidden = false;
    document.querySelector("#register-step-number").textContent = "3";
    document.querySelector("#register-identifier").value = "";
    announce("Registration complete");
  } catch (problem) {
    setMessage(document.querySelector("#register-confirm-error"), problem.message, "error");
    button.textContent = "Try again";
  } finally {
    registrationBusy = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});

async function prepareVerificationCamera() {
  const video = document.querySelector("#verify-video");
  const status = document.querySelector("#verify-status");
  try {
    verificationStream = await startCamera(video);
    document.querySelector("#verify-camera-placeholder").hidden = true;
    document.querySelector("#verify-start").disabled = false;
    setMessage(status, "Ready. Position one eye inside the guide.");
  } catch (problem) {
    setMessage(status, "Camera isn’t available. You can choose an image instead.");
    setMessage(document.querySelector("#verify-error"), problem.message, "error");
  }
}

document.querySelector("#verify-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const fileError = selectedFileError(file);
  if (fileError) {
    event.target.value = "";
    setMessage(document.querySelector("#verify-error"), fileError, "error");
    return;
  }
  verificationImage = file;
  stopCamera(document.querySelector("#verify-video"));
  verificationStream = null;
  verificationPreviewUrl = showImagePreview(
    file,
    document.querySelector("#verify-image-preview"),
    document.querySelector("#verify-video"),
    document.querySelector("#verify-camera-placeholder"),
    document.querySelector("#screen-verify .eye-guide"),
    verificationPreviewUrl,
  );
  document.querySelector("#verify-start").disabled = false;
  setMessage(document.querySelector("#verify-status"), "Image selected. Verify when you’re ready.");
  setMessage(document.querySelector("#verify-error"), "");
});

document.querySelector("#verify-start").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled || verificationBusy) return;
  verificationBusy = true;
  busyButton(button, true, "Checking…");
  setMessage(document.querySelector("#verify-error"), "");
  setMessage(document.querySelector("#verify-status"), "Checking. Keep still for a moment.");
  document.querySelector("#verify-result").hidden = true;
  try {
    const subjectId = await hashAccountIdentifier(document.querySelector("#verify-identifier").value);
    if (!verificationImage) verificationImage = await captureEyeImage(document.querySelector("#verify-video"));
    stopCamera(document.querySelector("#verify-video"));
    verificationStream = null;
    const result = await verifyImage(subjectId, verificationImage);
    const resultBox = document.querySelector("#verify-result");
    const resultTitle = document.querySelector("#verify-result-title");
    const resultDescription = document.querySelector("#verify-result-description");
    resultBox.hidden = false;
    resultBox.classList.toggle("is-success", result.verified);
    resultBox.classList.toggle("is-failure", !result.verified);
    resultTitle.textContent = result.verified ? "Identity verified" : "Verification unsuccessful";
    resultDescription.textContent = result.verified
      ? "Your check is complete. No matching details are shown here."
      : "We couldn’t verify this image. Try again in good light, or check the account identifier.";
    setMessage(document.querySelector("#verify-status"), "");
    verificationImage = null;
    clearImagePreview(document.querySelector("#verify-image-preview"), verificationPreviewUrl);
    verificationPreviewUrl = "";
    document.querySelector("#verify-image-preview").hidden = true;
    document.querySelector("#verify-file").value = "";
    document.querySelector("#verify-identifier").value = "";
    announce(resultTitle.textContent);
  } catch (problem) {
    verificationImage = null;
    setMessage(document.querySelector("#verify-error"), problem.message, "error");
    setMessage(document.querySelector("#verify-status"), "Verification couldn’t be completed.", "error");
    const selectedFile = document.querySelector("#verify-file").files?.[0];
    if (selectedFile) verificationImage = selectedFile;
    else if (!verificationStream) await prepareVerificationCamera();
  } finally {
    verificationBusy = false;
    button.disabled = !verificationStream && !verificationImage;
    button.removeAttribute("aria-busy");
    button.textContent = "Verify me";
  }
});

document.querySelector("#verify-again").addEventListener("click", () => {
  resetVerification();
  prepareVerificationCamera();
});

document.querySelector("#delete-record").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  const status = document.querySelector("#delete-status");
  try {
    const subjectId = await hashAccountIdentifier(document.querySelector("#delete-identifier").value);
    if (!window.confirm("Delete this registration from the local database? You can’t undo this.")) return;
    busyButton(button, true, "Deleting…");
    await deleteRegistration(subjectId);
    document.querySelector("#delete-identifier").value = "";
    setMessage(status, "Registration deleted.", "success");
  } catch (problem) {
    setMessage(status, problem.message, "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Delete my registration";
  }
});

window.addEventListener("pagehide", () => {
  stopCamera(document.querySelector("#register-video"));
  stopCamera(document.querySelector("#verify-video"));
  clearImagePreview(document.querySelector("#register-image-preview"), registrationPreviewUrl);
  clearImagePreview(document.querySelector("#verify-image-preview"), verificationPreviewUrl);
  document.querySelector("#register-file").value = "";
  document.querySelector("#verify-file").value = "";
  registrationImage = null;
  verificationImage = null;
  registrationSubjectId = "";
  registrationPreviewUrl = "";
  verificationPreviewUrl = "";
});