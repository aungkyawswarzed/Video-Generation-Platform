import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, getJob, getMedia, mediaPath, patchJob, putMedia } from './db';
import type { Job } from './types';
import { id, shotDuration } from './project';
import type { ChildProcess } from 'node:child_process';

const mediaProcesses = new Set<ChildProcess>();
export function stopMediaProcesses() {
  for (const child of mediaProcesses) child.kill();
}

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return createRequire(import.meta.url)('ffmpeg-static') || 'ffmpeg';
  } catch {
    return 'ffmpeg';
  }
}
export async function runFfmpeg(args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-y', ...args], {
      cwd,
      windowsHide: true,
    });
    mediaProcesses.add(child);
    child.once('close', () => mediaProcesses.delete(child));
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('FFmpeg timed out after 20 minutes.'));
    }, 20 * 60000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          process.env.STUDIO_DESKTOP_TOKEN
            ? `The packaged video engine could not start: ${e.message}. Restart or reinstall Frame Studio.`
            : `FFmpeg is unavailable: ${e.message}. Install FFmpeg or set FFMPEG_PATH.`,
        ),
      );
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}: ${stderr}`));
    });
  });
}
function srtTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export async function renderExport(job: Job) {
  const p = job.snapshot;
  const shots = p.scenes.flatMap((s) => s.shots);
  if (!shots.length) throw new Error('Add at least one shot.');
  const directory = path.join(dataDir, 'renders', job.id);
  await mkdir(directory, { recursive: true });
  const ratio = p.aspectRatio.split(':').map(Number);
  const height = 1080;
  const width = Math.round((height * ratio[0]) / ratio[1] / 2) * 2;
  let elapsed = 0;
  let captions = '';
  let caption = 1;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (!shot.selectedTakeId) throw new Error(`Select a take for “${shot.title}”.`);
    const take = getJob(shot.selectedTakeId);
    if (
      take.projectId !== p.id ||
      take.shotId !== shot.id ||
      take.status !== 'ready' ||
      !take.mediaId
    )
      throw new Error(`“${shot.title}” has no ready take.`);
    const duration = shotDuration(shot);
    if (duration <= 0) throw new Error(`Invalid trim range for “${shot.title}”.`);
    const source = getMedia(take.mediaId);
    if (source.projectId !== p.id) throw new Error('Invalid source asset.');
    // A silent base track ensures every segment has audio, even for silent model outputs.
    const output = path.join(directory, `clip-${i}.mp4`);
    const baseArgs = [
      '-ss',
      String(shot.trimStart),
      '-i',
      mediaPath(source.id),
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-t',
      String(duration),
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`,
      '-map',
      '0:v:0',
    ];
    // Probe audio through ffmpeg, avoiding a second platform-specific ffprobe dependency.
    let hasAudio = true;
    try {
      await runFfmpeg([
        '-i',
        mediaPath(source.id),
        '-map',
        '0:a:0',
        '-t',
        '0.01',
        '-f',
        'null',
        '-',
      ]);
    } catch {
      hasAudio = false;
    }
    await runFfmpeg([
      ...baseArgs,
      '-map',
      hasAudio ? '0:a:0' : '1:a:0',
      '-af',
      `apad,atrim=duration=${duration},aresample=48000`,
      '-ac',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      output,
    ]);
    if (shot.overlay.trim())
      captions += `${caption++}\n${srtTime(elapsed)} --> ${srtTime(elapsed + duration)}\n${shot.overlay.replace(/\r/g, '').replace(/\n\n/g, '\n')}\n\n`;
    elapsed = Math.round((elapsed + duration) * 1000) / 1000;
    patchJob(job.id, { heartbeat: Date.now() });
  }
  await writeFile(
    path.join(directory, 'concat.txt'),
    shots.map((_, i) => `file 'clip-${i}.mp4'`).join('\n'),
  );
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'assembled.mp4'],
    directory,
  );
  const finalArgs = ['-i', 'assembled.mp4'];
  if (p.musicId) {
    const music = getMedia(p.musicId);
    if (music.projectId !== p.id || !music.mime.startsWith('audio/'))
      throw new Error('Music must be a project audio file.');
    finalArgs.push('-stream_loop', '-1', '-i', mediaPath(music.id));
    finalArgs.push(
      '-filter_complex',
      `[1:a]volume=${p.musicVolume}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0[a]`,
      '-map',
      '0:v:0',
      '-map',
      '[a]',
    );
  }
  if (captions) {
    await writeFile(path.join(directory, 'captions.srt'), captions);
    finalArgs.push('-vf', "subtitles=captions.srt:force_style='FontSize=24,Outline=2,MarginV=45'");
  }
  finalArgs.push(
    '-t',
    String(elapsed),
    '-c:v',
    captions ? 'libx264' : 'copy',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    'final.mp4',
  );
  await runFfmpeg(finalArgs, directory);
  const mediaId = id();
  await copyFile(path.join(directory, 'final.mp4'), mediaPath(mediaId));
  const size = (await stat(mediaPath(mediaId))).size;
  putMedia({
    id: mediaId,
    projectId: p.id,
    name: `${p.name}.mp4`,
    mime: 'video/mp4',
    size,
    createdAt: new Date().toISOString(),
  });
  patchJob(job.id, { status: 'ready', mediaId, error: undefined });
}
