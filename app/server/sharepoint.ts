/**
 * SharePoint client using Microsoft Graph API with ROPC (user identity).
 * Fetches documents from SharePoint AS the actual user — honoring per-user permissions.
 * No fallback to client credentials when a user email is provided.
 */

// ── Config from environment ────────────────────────────────────────────────
const TENANT_ID = process.env.AZURE_TENANT_ID || "";
const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const SP_HOSTNAME = process.env.SHAREPOINT_HOSTNAME || "revapreview.sharepoint.com";
const SP_SITE_PATH = process.env.SHAREPOINT_SITE_PATH || "/sites/RetailManagement";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA = "https://graph.microsoft.com/beta";

// ── User identity mapping: Okta email → Azure AD credentials ──────────────
// For demo: maps SecureBank/Okta users to their Azure AD identities
const USER_MAP: Record<string, { username: string; password: string }> = {
  "mike.wilson@reva.ai": {
    username: process.env.MIKE_AZURE_USERNAME || "mike.wilson@revapreview.onmicrosoft.com",
    password: process.env.MIKE_AZURE_PASSWORD || "",
  },
  "john.smith@reva.ai": {
    username: process.env.JOHN_AZURE_USERNAME || "john.smith@revapreview.onmicrosoft.com",
    password: process.env.JOHN_AZURE_PASSWORD || "",
  },
  "sarah.johnson@reva.ai": {
    username: process.env.SARAH_AZURE_USERNAME || "sarah.johnson@revapreview.onmicrosoft.com",
    password: process.env.SARAH_AZURE_PASSWORD || "",
  },
};

// ── Token caches ───────────────────────────────────────────────────────────
const userTokenCache: Map<string, { token: string; expiry: number }> = new Map();
let appToken: string | null = null;
let appTokenExpiry: number = 0;

// ── Sensitivity label cache (avoid repeated calls to list all labels) ──────
let labelMapCache: Map<string, string> | null = null;
let labelMapExpiry: number = 0;

/**
 * Get a user-specific token via ROPC flow.
 */
async function getUserToken(oktaEmail: string): Promise<string | null> {
  const userCreds = USER_MAP[oktaEmail.toLowerCase()];
  if (!userCreds || !userCreds.password) {
    console.log(`[SharePoint] No Azure AD mapping for user: ${oktaEmail}`);
    return null;
  }

  const cached = userTokenCache.get(oktaEmail);
  if (cached && Date.now() < cached.expiry - 300_000) {
    return cached.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "password",
    username: userCreds.username,
    password: userCreds.password,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = (await res.json()) as any;
    console.error(`[SharePoint] ROPC auth failed for ${oktaEmail}:`, err.error_description);
    return null;
  }

  const data = (await res.json()) as any;
  userTokenCache.set(oktaEmail, {
    token: data.access_token,
    expiry: Date.now() + data.expires_in * 1000,
  });

  console.log(`[SharePoint] Authenticated as user: ${userCreds.username}`);
  return data.access_token;
}

/**
 * Get an app-level token using client credentials (fallback).
 */
async function getAppToken(): Promise<string> {
  if (appToken && Date.now() < appTokenExpiry - 300_000) {
    return appToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SharePoint auth failed: ${res.status} - ${err}`);
  }

  const data = (await res.json()) as any;
  appToken = data.access_token;
  appTokenExpiry = Date.now() + data.expires_in * 1000;

  console.log("[SharePoint] Authenticated with client credentials (fallback)");
  return appToken!;
}

/**
 * Get the best available token: user-specific (ROPC) if possible.
 * Does NOT fall back to client credentials when a user email is provided.
 */
async function getToken(oktaEmail?: string): Promise<string> {
  if (oktaEmail) {
    const userTok = await getUserToken(oktaEmail);
    if (userTok) return userTok;
    // No fallback — if user auth fails, deny access
    throw new Error("403: User does not have SharePoint access");
  }
  // Only use client credentials if no user email provided
  return getAppToken();
}

/**
 * Helper: make an authenticated Graph API call.
 */
async function graphGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error: ${res.status} - ${err}`);
  }

  return res.json();
}

/**
 * Build a map of sensitivity label GUIDs to display names.
 * Cached for 1 hour to avoid repeated calls.
 */
async function getLabelMap(token: string): Promise<Map<string, string>> {
  if (labelMapCache && Date.now() < labelMapExpiry) {
    return labelMapCache;
  }

  const map = new Map<string, string>();

  try {
    const labelsUrl = `${GRAPH_BETA}/security/informationProtection/sensitivityLabels`;
    console.log(`[SharePoint] Fetching all sensitivity labels from: ${labelsUrl}`);

    const res = await fetch(labelsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const labels = data.value || [];
      for (const label of labels) {
        map.set(label.id.toLowerCase(), label.name);
        console.log(`[SharePoint] Label registered: ${label.id} → ${label.name}`);
      }
      labelMapCache = map;
      labelMapExpiry = Date.now() + 60 * 60 * 1000; // cache for 1 hour
    } else {
      const errText = await res.text();
      console.log(`[SharePoint] Failed to list sensitivity labels: ${res.status} - ${errText}`);
    }
  } catch (err) {
    console.error(`[SharePoint] Error fetching label list:`, err);
  }

  return map;
}

/**
 * Fetch the sensitivity label name for a specific file.
 * Uses extractSensitivityLabels API (v1.0, GA, free).
 * Maps the returned GUID to a display name using the beta labels list.
 */
async function getFileSensitivityLabel(
  siteId: string,
  driveId: string,
  itemId: string,
  token: string
): Promise<string> {
  try {
    // Step 1: Extract sensitivity label ID from the file
    const extractUrl = `${GRAPH_BASE}/sites/${siteId}/drives/${driveId}/items/${itemId}/extractSensitivityLabels`;
    console.log(`[SharePoint] Extracting sensitivity label from: ${extractUrl}`);

    const extractRes = await fetch(extractUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!extractRes.ok) {
      const errText = await extractRes.text();
      console.log(`[SharePoint] extractSensitivityLabels error ${extractRes.status}: ${errText}`);

      // Fallback: try beta endpoint driveItem property
      console.log(`[SharePoint] Trying beta driveItem fallback...`);
      const betaUrl = `${GRAPH_BETA}/sites/${siteId}/drives/${driveId}/items/${itemId}?$select=id,name,sensitivityLabel`;
      const betaRes = await fetch(betaUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (betaRes.ok) {
        const betaData = (await betaRes.json()) as any;
        if (betaData.sensitivityLabel?.displayName) {
          console.log(`[SharePoint] Beta fallback got label: ${betaData.sensitivityLabel.displayName}`);
          return betaData.sensitivityLabel.displayName;
        }
      }
      return "Unknown";
    }

    const extractData = (await extractRes.json()) as any;
    console.log(`[SharePoint] extractSensitivityLabels response:`, JSON.stringify(extractData));

    const labels = extractData.labels || [];
    if (labels.length === 0) {
      console.log(`[SharePoint] No sensitivity label assigned to this file`);
      return "None";
    }

    const labelId = labels[0].sensitivityLabelId;
    console.log(`[SharePoint] Found label GUID: ${labelId}`);

    // Step 2: Map the label GUID to a display name
    const labelMap = await getLabelMap(token);
    const labelName = labelMap.get(labelId.toLowerCase());

    if (labelName) {
      console.log(`[SharePoint] Mapped label: ${labelId} → ${labelName}`);
      return labelName;
    }

    // If we can't map the GUID, return the GUID so it's not silently lost
    console.log(`[SharePoint] Could not map label GUID to name, returning GUID`);
    return `label:${labelId}`;
  } catch (err) {
    console.error(`[SharePoint] Error fetching sensitivity label:`, err);
    return "Unknown";
  }
}

/**
 * Search for files in SharePoint matching a query.
 */
export async function searchSharePointFiles(query: string, token?: string): Promise<any[]> {
  const tok = token || (await getAppToken());
  const siteData = await graphGet(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`, tok);
  const siteId = siteData.id;
  const drivesData = await graphGet(`/sites/${siteId}/drives`, tok);
  const driveId = drivesData.value[0]?.id;
  if (!driveId) return [];

  const data = await graphGet(
    `/sites/${siteId}/drives/${driveId}/root/search(q='${encodeURIComponent(query)}')`,
    tok
  );

  return (data.value || []).map((item: any) => ({
    name: item.name,
    id: item.id,
    webUrl: item.webUrl,
    size: item.size,
    lastModified: item.lastModifiedDateTime,
  }));
}

/**
 * Download a file's content as text.
 */
export async function downloadFileContent(
  fileId: string,
  fileName: string,
  token?: string,
  siteId?: string,
  driveId?: string
): Promise<string> {
  const tok = token || (await getAppToken());

  if (!siteId || !driveId) {
    const siteData = await graphGet(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`, tok);
    siteId = siteData.id;
    const drivesData = await graphGet(`/sites/${siteId}/drives`, tok);
    driveId = drivesData.value[0]?.id;
  }

  const textExtensions = [".txt", ".csv", ".json", ".md", ".xml", ".html", ".htm"];
  const ext = fileName.includes(".") ? "." + fileName.split(".").pop()!.toLowerCase() : "";

  if (!textExtensions.includes(ext)) {
    return `[Document: ${fileName} — binary file, content available in SharePoint]`;
  }

  const res = await fetch(
    `${GRAPH_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/content`,
    { headers: { Authorization: `Bearer ${tok}` }, redirect: "follow" }
  );

  if (!res.ok) {
    return `[Document: ${fileName} — could not download: ${res.status}]`;
  }

  const text = await res.text();
  const MAX_CHARS = 5000;
  if (text.length > MAX_CHARS) {
    return text.slice(0, MAX_CHARS) + `\n... [truncated, full document: ${fileName}]`;
  }
  return text;
}

/**
 * List all files in the root of the document library.
 */
export async function listSharePointFiles(token?: string): Promise<any[]> {
  const tok = token || (await getAppToken());
  const siteData = await graphGet(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`, tok);
  const siteId = siteData.id;
  const drivesData = await graphGet(`/sites/${siteId}/drives`, tok);
  const driveId = drivesData.value[0]?.id;
  if (!driveId) return [];

  const data = await graphGet(`/sites/${siteId}/drives/${driveId}/root/children`, tok);

  return (data.value || [])
    .filter((item: any) => "file" in item)
    .map((item: any) => ({
      name: item.name,
      id: item.id,
      size: item.size,
      lastModified: item.lastModifiedDateTime,
    }));
}

/**
 * Main function: fetch relevant SharePoint documents for a user query.
 * Uses ROPC to authenticate as the actual user if possible.
 * Return type matches exactly what routes.ts expects.
 */
export async function getSharePointContext(
  userMessage: string,
  oktaEmail?: string
): Promise<{ context: string; documentName: string; sensitivityLabel: string }> {
  // Skip if credentials aren't configured
  if (!TENANT_ID || !CLIENT_ID) {
    console.log("[SharePoint] Credentials not configured, skipping");
    return { context: "", documentName: "", sensitivityLabel: "" };
  }

  try {
    // Get token — user-specific (ROPC) if possible, throws error if user auth fails
    const token = await getToken(oktaEmail);

    const siteData = await graphGet(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`, token);
    const siteId = siteData.id;

    const drivesData = await graphGet(`/sites/${siteId}/drives`, token);
    const drives = drivesData.value || [];
    if (drives.length === 0)
      return { context: "", documentName: "", sensitivityLabel: "" };

    const driveId = drives[0].id;

    // Search for files relevant to the user's question
    let files = await searchSharePointFiles(userMessage, token);

    if (files.length === 0) {
      // Fall back to listing all files if search returns nothing
      files = await listSharePointFiles(token);
      if (files.length === 0)
        return { context: "", documentName: "", sensitivityLabel: "" };
    }

    // Take first 5 files and try to read them
    const docs: string[] = [];
    let firstDocName = "";
    let firstSensitivityLabel = "Unknown";

    for (const file of files.slice(0, 5)) {
      const content = await downloadFileContent(file.id, file.name, token, siteId, driveId);
      docs.push(`=== ${file.name} ===\n${content}`);

      // Fetch sensitivity label dynamically for the first matching file
      if (!firstDocName) {
        firstDocName = file.name;
        console.log(`[SharePoint] First document: ${firstDocName} (id: ${file.id})`);
        firstSensitivityLabel = await getFileSensitivityLabel(siteId, driveId, file.id, token);
        console.log(`[SharePoint] Sensitivity label for ${file.name}: ${firstSensitivityLabel}`);
      }
    }

    const who = oktaEmail ? ` (accessed as ${oktaEmail})` : "";
    console.log(
      `[SharePoint] Returning: documentName=${firstDocName}, sensitivityLabel=${firstSensitivityLabel}, docs=${docs.length}`
    );
    const context = `\n\n--- SharePoint Documents (RetailManagement)${who} ---\n${docs.join("\n\n")}`;
    return { context, documentName: firstDocName, sensitivityLabel: firstSensitivityLabel };
  } catch (error: any) {
    if (error.message?.includes("403")) {
      const denied = oktaEmail ? ` User ${oktaEmail} does not have permission.` : "";
      return {
        context: `\n\n[SharePoint: Access denied.${denied}]`,
        documentName: "",
        sensitivityLabel: "",
      };
    }
    console.error("[SharePoint] Error fetching documents:", error);
    return { context: "", documentName: "", sensitivityLabel: "" };
  }
}

/**
 * Check if SharePoint integration is configured and working.
 */
export async function testSharePointConnection(): Promise<{
  ok: boolean;
  message: string;
  files?: string[];
}> {
  try {
    if (!TENANT_ID || !CLIENT_ID) {
      return { ok: false, message: "SharePoint credentials not configured" };
    }

    const files = await listSharePointFiles();
    return {
      ok: true,
      message: `Connected to SharePoint. Found ${files.length} files.`,
      files: files.map((f) => f.name),
    };
  } catch (error: any) {
    return { ok: false, message: `SharePoint connection failed: ${error.message}` };
  }
}