import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';

const skills = ['design-studio-ai', 'design-strategy'];

async function packageSkill(name) {
  const source = resolve(`skills/${name}`);
  const zip = new JSZip();

  async function include(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await include(file);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        zip.file(`${name}/${relative(source, file).replaceAll('\\', '/')}`, await readFile(file));
      }
    }
  }

  await include(source);
  if (!zip.file(`${name}/SKILL.md`) || !Object.keys(zip.files).some(path => path.includes('/references/'))) {
    throw new Error(`${name} skill package must include its entrypoint and reference guides.`);
  }

  await mkdir('dist', { recursive: true });
  await writeFile(`dist/${name}-skill.zip`, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`Packaged ${Object.values(zip.files).filter(file => !file.dir).length} ${name} skill files in dist/${name}-skill.zip`);
}

for (const skill of skills) await packageSkill(skill);
