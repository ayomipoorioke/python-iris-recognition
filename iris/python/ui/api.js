let apiToken = "";

export function setApiToken(value) {
  apiToken = value.trim();
}

export function hasApiToken() {
  return apiToken.length > 0;
}

export async function hashAccountIdentifier(value) {
  const identifier = value.trim().normalize("NFKC").toLowerCase();
  if (!identifier || identifier.length > 254) {
    throw new Error("Enter an account email or username, up to 254 characters.");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure browser hashing is unavailable. Open this app at its localhost address.");
  }

  const bytes = new TextEncoder().encode(identifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function friendlyError(status, detail) {
  if (status === 401) return "The local access key was not accepted. Check it in Settings & Help.";
  if (status === 404) return "No registration was found for those details. Register first, or check the account identifier.";
  if (status === 409) return "A registration already exists for those details. Verify it or delete it before registering again.";
  if (status === 413) return "That image is too large. Choose one under 5 MB.";
  if (status === 422) return "We couldn’t read that eye image. Try a clear, close image without sunglasses.";
  if (status === 429) return "There have been several tries. Wait a minute, then try again.";
  if (status >= 500) return "The local service had a problem. Check that it is running, then try again.";
  if (status === 400 && detail) return "Please check the information and consent, then try again.";
  return "Something went wrong. Check the information and try again.";
}

async function postImage(path, subjectId, image, consent = false) {
  if (!apiToken) throw new Error("Enter the local access key in Settings & Help first.");

  const form = new FormData();
  form.append("subject_id", subjectId);
  form.append("image", image, "eye-image.jpg");
  if (consent) form.append("consent", "true");

  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
    });
  } catch {
    throw new Error("Couldn’t reach the local service. Make sure it is running in PowerShell.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(friendlyError(response.status, payload.detail));
  return payload;
}

export function enrollImage(subjectId, image) {
  return postImage("/v1/enroll", subjectId, image, true);
}

export function verifyImage(subjectId, image) {
  return postImage("/v1/verify", subjectId, image);
}

export async function deleteRegistration(subjectId) {
  if (!apiToken) throw new Error("Enter the local access key in Settings & Help first.");
  let response;
  try {
    response = await fetch(`/v1/templates/${encodeURIComponent(subjectId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    });
  } catch {
    throw new Error("Couldn’t reach the local service. Make sure it is running in PowerShell.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(friendlyError(response.status, payload.detail));
  return payload;
}