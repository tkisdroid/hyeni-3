// 기존 3D 혜니 스토어 아이콘을 웹 설치용 크기로 출력한다. 원본 디자인은 변경하지 않는다.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const source = fileURLToPath(new URL('output/play-store-final-v1/play-icon-512.png', root));
for (const [name, size] of [
  ['apple-touch-icon-hyeni-3d.png', 180],
  ['apple-touch-icon.png', 180],
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['pwa-maskable-512x512.png', 512],
]) {
  await sharp(source).flatten({ background: '#fff6f1' }).resize(size, size)
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL(`public/${name}`, root)));
}
