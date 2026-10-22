// Configuração do app (pública). `caixa` = endereço da caixa de entrada (Cloudflare Worker) que recebe os pedidos de
// acesso e as inscrições de notificação; o MAPI busca lá. Vazio = o app não mostra "Solicitar acesso" nem liga o push.
window.PS_CONFIG = { caixa: '' };
