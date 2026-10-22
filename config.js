// Configuração do app (pública). `caixa` = endereço da caixa de entrada (Cloudflare Worker) que recebe os pedidos de
// acesso e as inscrições de notificação; o MAPI busca lá. Vazio = o app não mostra "Solicitar acesso" nem liga o push.
// Para trocar de caixa (ex.: outra conta da Cloudflare), basta mudar este endereço e fazer commit.
window.PS_CONFIG = { caixa: 'https://gentle-band-9798.wro-1984.workers.dev' };
