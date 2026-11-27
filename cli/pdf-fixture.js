'use strict';
/**
 * Minimal PDF fixture builder for tests. No dependencies.
 * All content is ASCII, so string length === byte length (latin1).
 */
function buildPdfFixture(opts) {
    opts = opts || {};
    const pageCount = opts.pageCount === undefined ? 3 : opts.pageCount;
    const width = opts.width || 612;
    const height = opts.height || 792;
    const withOutline = opts.outline !== false && pageCount >= 2;
    const rotateLast = !!opts.rotateLast;
    const blank = !!opts.blank;

    let next = 1;
    const catalogNum = next++;
    const pagesNum = next++;
    const fontNum = next++;
    const pageNums = [], contentNums = [];
    for (let i = 0; i < pageCount; i++) { pageNums.push(next++); contentNums.push(next++); }
    let outlineNum = 0, firstNum = 0, secondNum = 0;
    if (withOutline) { outlineNum = next++; firstNum = next++; secondNum = next++; }

    const objects = [];
    objects.push({ num: catalogNum, body: `<< /Type /Catalog /Pages ${pagesNum} 0 R${withOutline ? ` /Outlines ${outlineNum} 0 R` : ''} >>` });
    objects.push({ num: pagesNum, body: `<< /Type /Pages /Kids [${pageNums.map(n => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>` });
    objects.push({ num: fontNum, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });
    for (let i = 0; i < pageCount; i++) {
        const rotate = rotateLast && i === pageCount - 1 ? ' /Rotate 90' : '';
        objects.push({ num: pageNums[i], body: `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${width} ${height}]${rotate} /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNums[i]} 0 R >>` });
        const stream = blank ? '' : `BT /F1 24 Tf 72 720 Td (Page ${i + 1}) Tj ET\n0 0 0 rg 72 72 468 600 re f\n`;
        objects.push({ num: contentNums[i], body: `<< /Length ${stream.length} >>\nstream\n${stream}endstream` });
    }
    if (withOutline) {
        objects.push({ num: outlineNum, body: `<< /Type /Outlines /First ${firstNum} 0 R /Last ${secondNum} 0 R /Count 2 >>` });
        objects.push({ num: firstNum, body: `<< /Title (Chapter One) /Parent ${outlineNum} 0 R /Next ${secondNum} 0 R /Dest [${pageNums[0]} 0 R /XYZ 0 ${height} 0] >>` });
        objects.push({ num: secondNum, body: `<< /Title (Chapter Two) /Parent ${outlineNum} 0 R /Prev ${firstNum} 0 R /Dest [${pageNums[1]} 0 R /XYZ 0 ${height} 0] >>` });
    }

    objects.sort((a, b) => a.num - b.num);
    let out = '%PDF-1.4\n';
    const offsets = {};
    for (const obj of objects) {
        offsets[obj.num] = out.length;
        out += `${obj.num} 0 obj\n${obj.body}\nendobj\n`;
    }
    const xrefOffset = out.length;
    const maxNum = objects[objects.length - 1].num;
    out += `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= maxNum; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${maxNum + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, 'latin1'));
}

module.exports = { buildPdfFixture };
