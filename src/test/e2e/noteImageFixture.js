// Five independently decodable figures; image URLs dominate the Markdown size.
export const noteImageURLs = Array.from({ length: 5 }, (_, index) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260"><!--${'x'.repeat(400000)}--><rect width="600" height="260" fill="#edf3ef"/><text x="30" y="80" font-size="28">Supplementary figure ${index + 1}</text></svg>`).toString('base64'));
export const literalImageURL = 'data:image/png;base64,iVBORw0KGgo=';
export const imageNote = '# 图片与研究笔记\n\n保留 **正文格式**、公式 $x^2$ 与全部原图。\n\n' + noteImageURLs.map((url, i) => `## 证据 ${i + 1}\n\n![图 ${i + 1}](${url})\n\n`).join('') + `\n代码示例：\`${literalImageURL}\`\n\n\`\`\`text\n![literal](${literalImageURL})\n\`\`\`\n\n编辑位置。\n`;
