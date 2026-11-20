# DNS atual de doniniadvocacia.com.br

Consultado em 19/11/2026 via dns.google.

**Servidores DNS:** a.sec.dns.br, c.sec.dns.br → o DNS é gerenciado no próprio Registro.br (não no Wix).

**E-mail:** Microsoft 365 (Exchange Online).

| Nome | Tipo | Valor | Para quê |
|---|---|---|---|
| doniniadvocacia.com.br | A | 185.230.63.107 | Site no Wix — será trocado |
| www | CNAME | pointing.wixdns.net | Site no Wix — será trocado |
| doniniadvocacia.com.br | MX | 0 doniniadvocacia-com-br.mail.protection.outlook.com | E-mail M365 — MANTER |
| doniniadvocacia.com.br | TXT | v=spf1 include:spf.protection.outlook.com -all | SPF — MANTER |
| autodiscover | CNAME | autodiscover.outlook.com | Configuração do Outlook — MANTER |
| _dmarc | TXT | v=DMARC1; p=none; | DMARC — MANTER |
| selector1._domainkey | CNAME | (não existe) | DKIM não configurado — recomendado ativar no M365 |

## Consequência para o plano

Como o DNS já está no Registro.br, há duas opções:

1. **Manter o DNS no Registro.br (mais simples):** apontar só o `www` para o Cloudflare Pages (CNAME para `<projeto>.pages.dev`) e redirecionar o domínio sem www para o www. O e-mail não é tocado. Limitação: o Registro.br não aceita CNAME no domínio raiz; o endereço sem www precisaria de um redirecionamento.
2. **Mover o DNS para o Cloudflare (recomendado no plano):** trocar os servidores no Registro.br para os do Cloudflare e recriar os 4 registros de e-mail acima. Permite servir o domínio sem www direto e dá CDN/SSL completos.

Outros registros (verificações do Google, Meta etc.) não aparecem nas consultas padrão; conferir a zona completa no painel do Registro.br antes da virada.
