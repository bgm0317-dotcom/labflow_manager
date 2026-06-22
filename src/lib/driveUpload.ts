// Google Drive 직접 업로드 (OAuth 2.0 / GIS)

import { EQUIP_ISSUE_FOLDER_ID, PLATE_ISSUE_FOLDER_ID, CHIP_IMAGE_FOLDER_ID } from './types';

export function createThumbnailBase64(file: File, size = 120): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(size / img.width, size / img.height);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = url;
  });
}


// 필요한 환경변수: VITE_GOOGLE_CLIENT_ID

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.events profile email';

const FOLDER_IDS: Record<'dna' | 'pellet', string> = {
  dna:    '1m5TAA7CCtQEC-2cPLa-NriXC_hRgWjuQ',
  pellet: '1SS4jZ8jP6_XTQV69QNpodFQC-uDY480v',
};

let cachedToken: { token: string; expires: number } | null = (() => {
  const saved = localStorage.getItem('google_access_token');
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return null; }
})();

function saveToken(token: string) {
  cachedToken = { token, expires: Date.now() + 55 * 60 * 1000 };
  localStorage.setItem('google_access_token', JSON.stringify(cachedToken));
}

function waitForGIS(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if ((window as any).google?.accounts?.oauth2) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Google 로그인 라이브러리 로드 실패'));
      }
    }, 100);
  });
}


function requestToken(scope: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('로그인 시간 초과. 다시 시도해주세요.')), 120000);
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope,
      prompt,
      error_callback: (err: any) => {
        clearTimeout(timer);
        const msg = err?.type === 'popup_closed' ? '로그인 창이 닫혔습니다. 다시 시도해주세요.'
          : err?.type === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'
          : `로그인 오류: ${err?.type || JSON.stringify(err)}`;
        reject(new Error(msg));
      },
      callback: (res: any) => {
        clearTimeout(timer);
        if (res.error) { reject(new Error(res.error_description || res.error)); return; }
        resolve(res.access_token);
      },
    });
    client.requestAccessToken();
  });
}

/** 로그인 — 모든 스코프(Drive/Sheets/profile) 한 번에 요청, 계정 선택창 표시 */
export async function getLoginToken(): Promise<{ token: string; name: string; email: string; picture: string }> {
  await waitForGIS();
  const token = await requestToken(SCOPE, 'select_account');
  saveToken(token);
  const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const info = await res.json();
  return { token, name: info.name || info.email || '', email: info.email || '', picture: info.picture || '' };
}

/** 데이터 접근용 — 캐시된 토큰 사용, 없으면 재요청 */
export async function getAccessToken(forceConsent = false): Promise<string> {
  if (!forceConsent && cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }
  await waitForGIS();
  const token = await requestToken(SCOPE, forceConsent ? 'consent' : '');
  saveToken(token);
  return token;
}

/** 캐시 토큰 삭제 후 강제 재동의 */
export async function reauthorize(): Promise<string> {
  cachedToken = null;
  localStorage.removeItem('google_access_token');
  return getAccessToken(true);
}

const folderPromiseCache: Record<string, Promise<string>> = {};

async function findOrCreateFolder(name: string, parentId: string, token: string): Promise<string> {
  const cacheKey = `${parentId}_${name}`;
  if (folderPromiseCache[cacheKey]) return folderPromiseCache[cacheKey];

  const promise = (async () => {
    const q = encodeURIComponent(`name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.files?.length > 0) return data.files[0].id as string;

    const createRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
      }
    );
    const created = await createRes.json();
    return created.id as string;
  })();

  folderPromiseCache[cacheKey] = promise;
  return promise;
}

const ISSUE_FOLDER_IDS: Record<'equipment' | 'plate' | 'chipImage', string> = {
  equipment: EQUIP_ISSUE_FOLDER_ID,
  plate:     PLATE_ISSUE_FOLDER_ID,
  chipImage: CHIP_IMAGE_FOLDER_ID,
};

async function uploadFileToDrive(
  file: File,
  parentFolderId: string,
  token: string
): Promise<{ fileId: string; fileName: string; viewUrl: string }> {
  const metadata = { name: file.name, parents: [parentFolderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || '업로드 실패'); }
  const uploaded = await res.json();
  return { fileId: uploaded.id, fileName: uploaded.name, viewUrl: `https://drive.google.com/file/d/${uploaded.id}/view` };
}

export async function uploadChipImageToDrive(
  file: File,
  date: string,
  token: string
): Promise<{ fileId: string; fileName: string; viewUrl: string }> {
  const dateFolderId = await findOrCreateFolder(date, ISSUE_FOLDER_IDS.chipImage, token);
  return uploadFileToDrive(file, dateFolderId, token);
}

export async function deleteFileFromDrive(fileId: string, token: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Drive 삭제 실패 ${res.status}`);
  }
}

export async function uploadIssueToDrive(
  file: File,
  date: string,
  token: string,
  issueType: 'equipment' | 'plate' = 'equipment'
): Promise<{ fileId: string; fileName: string; viewUrl: string }> {
  const dateFolderId = await findOrCreateFolder(date, ISSUE_FOLDER_IDS[issueType], token);
  return uploadFileToDrive(file, dateFolderId, token);
}

export async function uploadPhotoToDrive(
  file: File,
  photoType: 'dna' | 'pellet',
  date: string,
  token: string
): Promise<{ fileId: string; fileName: string; viewUrl: string }> {
  const rootFolderId = FOLDER_IDS[photoType];
  const dateFolderId = await findOrCreateFolder(date, rootFolderId, token);
  const metadata = { name: file.name, parents: [dateFolderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || '업로드 실패');
  }
  const uploaded = await res.json();
  return {
    fileId: uploaded.id,
    fileName: uploaded.name,
    viewUrl: `https://drive.google.com/file/d/${uploaded.id}/view`,
  };
}
