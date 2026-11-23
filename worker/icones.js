// Ícones em SVG (traço), no estilo do Diligo original.
import { seguro } from "./html.js";

const svg = (corpo, tamanho = 34) => seguro(`<svg aria-hidden="true" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`);

export const icone = {
  casa: (t) => svg('<path d="M3 11 12 3l9 8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>', t),
  documento: (t) => svg('<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/><path d="M9 12h7M9 16h7"/>', t),
  pessoas: (t) => svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.8 3.2-6 6.5-6s6 2.2 6.5 6z"/><circle cx="16.5" cy="7" r="3"/><path d="M17 13c2.6.3 4.3 2.3 4.6 5.5H17"/>', t),
  relogio: (t) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>', t),
  calendario: (t) => svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 14h2M11 14h2M15 14h2M7 17.5h2M11 17.5h2"/>', t),
  envelope: (t) => svg('<rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="m3 6 9 7 9-7"/>', t),
  engrenagem: (t) => svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>', t),
  sair: (t) => svg('<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>', t),
  lapis: (t) => svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>', t),
  seta: (t) => seguro(`<svg aria-hidden="true" width="${t || 18}" height="${t || 18}" viewBox="0 0 24 24" fill="currentColor"><path d="M14 4l8 7-8 7v-4.2C8.5 13.8 5 15.6 2 20c1-6.2 4.8-10.4 12-11.3z"/></svg>`),
  folha: (t) => seguro(`<svg aria-hidden="true" width="${t || 18}" height="${t || 18}" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2h9l5 5v15H5z" opacity=".95"/><path d="M14 2v5h5" fill="#fff" opacity=".35"/></svg>`),
  // marcas d'água dos cartões
  balanca: (t) => svg('<path d="M12 3v17M7 21h10M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>', t),
  agenda: (t) => svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17.5h2M11 17.5h2"/>', t),
  alerta: (t) => svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>', t),
};
