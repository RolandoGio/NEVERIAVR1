import fs from 'fs/promises'
import path from 'path'

function escapePdfText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function buildPdfContent(title, lines) {
  const safeTitle = escapePdfText(title)
  const safeLines = lines.map(escapePdfText)
  const commands = [
    'BT',
    '/F1 18 Tf',
    '72 760 Td',
    `(${safeTitle}) Tj`,
    '0 -30 Td',
    '/F1 12 Tf',
  ]

  let y = 0
  for (const line of safeLines) {
    commands.push(`(${line}) Tj`)
    commands.push('T*')
    y -= 14
    if (y < -700) break
  }
  commands.push('ET')
  return commands.join('\n')
}

export async function generateSimplePdf({ title, lines, outputDir, filename }) {
  const content = buildPdfContent(title, lines)
  const contentBytes = Buffer.from(content, 'utf8')
  const objects = []

  function addObject(body) {
    objects.push(body)
    return objects.length
  }

  addObject('<< /Type /Catalog /Pages 2 0 R >>')
  addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>')
  addObject(`<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`)
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  let offset = 0
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
  const bodyParts = ['%PDF-1.4']

  for (let i = 0; i < objects.length; i++) {
    const header = `${i + 1} 0 obj\n${objects[i]}\nendobj`
    bodyParts.push(header)
  }

  const joined = bodyParts.join('\n') + '\n'
  const buffers = []
  offset = joined.length
  const offsets = [0]
  let running = '%PDF-1.4\n'
  offsets[0] = 0
  const pieces = []
  let pointer = running.length
  pieces.push(running)
  for (let i = 0; i < objects.length; i++) {
    const header = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
    pieces.push(header)
    offsets.push(pointer)
    pointer += header.length
  }

  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
  for (const off of offsets.slice(1)) {
    xrefLines.push(String(off).padStart(10, '0') + ' 00000 n ')
  }
  const xrefSection = xrefLines.join('\n')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pointer}\n%%EOF`
  const pdf = pieces.join('') + xrefSection + '\n' + trailer

  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, filename)
  await fs.writeFile(outputPath, pdf, 'utf8')
  return outputPath
}

export default generateSimplePdf
