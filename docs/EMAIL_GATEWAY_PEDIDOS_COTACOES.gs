/**
 * COLORNET - Gateway Gmail para confirmações de pedidos e cotações.
 *
 * Conta executora recomendada: comercial.colornet@gmail.com
 * Script Properties:
 *   GMAIL_BRIDGE_SECRET
 *   EMAIL_CC_PEDIDOS
 *   EMAIL_CC_COTACOES
 *   EMAIL_REPLY_TO
 *
 * Deploy do Web App:
 *   Executar como: Eu
 *   Quem tem acesso: Qualquer pessoa / Anyone
 */
function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function emailValidoInterno_(email) {
  return /^[a-z0-9._%+\-]+@colornet\.com\.br$/i.test(String(email || '').trim());
}

function escPlain_(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function anexosPdf_(attachments) {
  if (!attachments) return [];
  if (!Array.isArray(attachments) || attachments.length > 3) {
    throw new Error('Lista de anexos inválida.');
  }

  return attachments.map(function(a) {
    var nome = String(a && a.name || '').replace(/[\\/]/g, '_').trim();
    var mime = String(a && a.mimeType || '').trim().toLowerCase();
    var base64 = String(a && a.base64 || '').replace(/\s+/g, '');

    if (!nome || nome.length > 180 || !/\.pdf$/i.test(nome)) {
      throw new Error('Nome de anexo PDF inválido.');
    }
    if (mime !== 'application/pdf') throw new Error('Somente PDF é permitido.');
    if (!base64 || base64.length > 15000000 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
      throw new Error('Conteúdo do PDF inválido ou maior que o limite.');
    }

    var bytes = Utilities.base64Decode(base64);
    return Utilities.newBlob(bytes, mime, nome);
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var travou = false;

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({ ok: false, erro: 'POST sem conteúdo.' });
    }

    var body;
    try { body = JSON.parse(e.postData.contents); }
    catch (_) { return jsonOutput_({ ok: false, erro: 'JSON inválido.' }); }

    var action = String(body.action || '');
    if (['CONFIRMACAO_PEDIDO', 'CONFIRMACAO_COTACAO'].indexOf(action) < 0) {
      return jsonOutput_({ ok: false, erro: 'Ação não permitida.' });
    }

    var props = PropertiesService.getScriptProperties();
    var secretEsperado = props.getProperty('GMAIL_BRIDGE_SECRET');
    var secretRecebido = String(body.secret || '');
    if (!secretEsperado) return jsonOutput_({ ok: false, erro: 'GMAIL_BRIDGE_SECRET não configurado.' });
    if (!secretRecebido || secretRecebido !== secretEsperado) {
      return jsonOutput_({ ok: false, erro: 'Não autorizado.' });
    }

    var numero = String(body.numero || '').trim();
    var idRegistro = action === 'CONFIRMACAO_COTACAO'
      ? String(body.cotacao_id || '').trim()
      : String(body.pedido_id || '').trim();
    var to = String(body.to || '').trim().toLowerCase();
    var subject = String(body.subject || '').trim();
    var htmlBody = String(body.htmlBody || '');

    if (!idRegistro || !numero) return jsonOutput_({ ok: false, erro: 'Registro sem identificação.' });
    if (!emailValidoInterno_(to)) {
      return jsonOutput_({ ok: false, erro: 'Destinatário inválido. Use @colornet.com.br.' });
    }
    if (!subject || !htmlBody) return jsonOutput_({ ok: false, erro: 'Assunto ou conteúdo vazio.' });

    if (!lock.tryLock(10000)) return jsonOutput_({ ok: false, erro: 'Gateway ocupado. Tente novamente.' });
    travou = true;

    var ccProperty = action === 'CONFIRMACAO_COTACAO' ? 'EMAIL_CC_COTACOES' : 'EMAIL_CC_PEDIDOS';
    var ccRaw = props.getProperty(ccProperty) || 'jrodrigues@colornet.com.br,marcia@colornet.com.br';
    var cc = ccRaw.split(',').map(function(x) { return x.trim().toLowerCase(); })
      .filter(Boolean).filter(emailValidoInterno_)
      .filter(function(email) { return email !== to; });

    var replyTo = String(props.getProperty('EMAIL_REPLY_TO') || 'jrodrigues@colornet.com.br').trim();
    var attachments = anexosPdf_(body.attachments || []);
    var quotaAntes = MailApp.getRemainingDailyQuota();
    var destinatariosNecessarios = 1 + cc.length;
    if (quotaAntes < destinatariosNecessarios) {
      return jsonOutput_({ ok: false, erro: 'Cota diária de destinatários insuficiente.', quota_restante: quotaAntes });
    }

    MailApp.sendEmail({
      to: to,
      cc: cc.join(','),
      subject: subject,
      body: escPlain_(htmlBody),
      htmlBody: htmlBody,
      attachments: attachments,
      name: 'ColorNet Comercial',
      replyTo: replyTo,
      noReply: false
    });

    return jsonOutput_({
      ok: true,
      provider: 'GOOGLE_MAILAPP',
      action: action,
      id: idRegistro,
      numero: numero,
      to: to,
      cc: cc,
      anexos: attachments.length,
      quota_restante: MailApp.getRemainingDailyQuota(),
      enviado_em: new Date().toISOString()
    });
  } catch (err) {
    return jsonOutput_({ ok: false, erro: err && err.message ? err.message : String(err) });
  } finally {
    if (travou) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function autorizarGatewayEmail() {
  Logger.log('Gateway autorizado. Cota restante: ' + MailApp.getRemainingDailyQuota());
}
