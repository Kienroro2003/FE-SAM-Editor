import JSZip from 'jszip';

export function resolveFolderName(files: File[]): string {
  const fileWithRelativePath = files.find((file) => file.webkitRelativePath.includes('/'));
  if (!fileWithRelativePath) {
    return '';
  }

  const [rootFolder] = fileWithRelativePath.webkitRelativePath.split('/');
  return rootFolder?.trim() ?? '';
}

export async function buildZipFromFolderFiles(files: File[], folderName: string): Promise<File> {
  if (files.length === 0) {
    throw new Error('Please select a folder to import.');
  }

  const zip = new JSZip();
  files.forEach((file) => {
    const rawPath = file.webkitRelativePath || file.name;
    const normalizedPath = rawPath
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      .join('/');

    if (normalizedPath.length > 0) {
      zip.file(normalizedPath, file);
    }
  });

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const safeName = folderName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);

  return new File([zipBlob], `${safeName || 'workspace'}.zip`, { type: 'application/zip' });
}
