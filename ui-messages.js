'use strict';
(() => {
  if (globalThis.LivrariaMessages) return;
  const codes = Object.freeze({
    INVALID_CPF:'CPF inválido. Confira os 11 números digitados.',
    INVALID_PIN:'O PIN precisa ter exatamente quatro números.',
    UNAUTHENTICATED:'Entre na sua conta para continuar.',
    REAUTHENTICATION_REQUIRED:'Confirme novamente sua identidade para continuar.',
    FORBIDDEN:'Não foi possível autorizar esta ação. Entre novamente. Se continuar, peça ajuda à administração.',
    AUTH_RATE_LIMITED:'Você fez várias tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.',
    BUSY:'Há outra operação em andamento. Aguarde alguns instantes e tente novamente.',
    SERVICE_CAPACITY:'O serviço recebeu muitas solicitações. Aguarde alguns minutos antes de tentar novamente.',
    MAINTENANCE_ACTIVE:'O sistema está em manutenção. Aguarde a liberação pela administração para continuar.',
    REPLAY:'Esta solicitação já foi recebida. Atualize a consulta para conferir o resultado.',
    SCHEMA_REQUIRED:'O serviço precisa ser atualizado pela administração. Tente novamente após a atualização.',
    SCHEMA_CONFLICT:'O serviço precisa ser revisado pela administração antes de continuar.',
    BINDING_MISMATCH:'Não conseguimos validar a instalação. Peça ajuda à administração.',
    IDENTITY_CONFIGURATION_UNAVAILABLE:'O acesso precisa ser configurado pela administração antes de continuar.',
    CONFIGURATION_UNAVAILABLE:'O serviço precisa ser configurado pela administração antes de continuar.',
    INTERNAL:'O serviço encontrou um problema. Aguarde alguns instantes e confira o resultado antes de repetir a ação. Se continuar, peça ajuda à administração.',
    ACCESS_CPF_NOT_REGISTERED:'CPF não cadastrado para acesso. Se está concluindo o cadastro master inicial, entre com o e-mail configurado e vincule o CPF em Meu perfil.',
    ACCESS_EMAIL_NOT_REGISTERED:'E-mail não cadastrado para acesso. Confira o endereço ou peça o cadastro à administração.',
    ACCESS_ALREADY_ACTIVATED:'Este cadastro já tem acesso ativo. Use “Entrar na minha conta”.',
    ACCESS_CPF_NOT_AVAILABLE:'O acesso por CPF ainda precisa ser habilitado. Para concluir o cadastro master inicial, use o e-mail configurado.',
    ACCESS_EMAIL_DELIVERY_UNAVAILABLE:'Não conseguimos confirmar o envio do código. Aguarde alguns instantes e solicite novamente.',
    AUTH_DELIVERY_RATE_LIMITED:'Um código foi solicitado há pouco. Confira o e-mail mais recente ou aguarde um minuto antes de solicitar outro.',
    STAFF_CPF_DUPLICATE:'CPF já cadastrado. Localize o cadastro existente antes de continuar.',
    STAFF_EMAIL_DUPLICATE:'E-mail já cadastrado. Use outro endereço ou localize o cadastro existente.',
    PROFILE_CPF_DUPLICATE:'CPF já cadastrado para outra pessoa. Confira os números ou peça ajuda à administração.',
    PROFILE_CPF_LOCKED:'O CPF já está vinculado ao seu cadastro. Para corrigir, solicite ajuda à administração.',
    CUSTOMER_DUPLICATE:'CPF já cadastrado. Localize o cliente existente antes de cadastrar novamente.',
    CUSTOMER_NOT_FOUND:'Cliente não encontrado. Confira o CPF informado.',
    CUSTOMER_CONTACT_NOT_AUTHORIZED:'Este cliente não autorizou contato por este canal. Confira a preferência no cadastro.',
    INSUFFICIENT_STOCK:'A quantidade disponível mudou. Atualize o carrinho e confira as quantidades.',
    PRODUCT_UNAVAILABLE:'Este livro não está disponível para venda. Atualize o catálogo e escolha outro livro.',
    SALE_PRICE_CHANGED:'O preço mudou. Atualize o carrinho e confira o novo total antes de confirmar.',
    SALE_NOT_FOUND:'Venda não encontrada. Confira a referência e consulte novamente.',
    STOCK_LIMIT:'Esta quantidade ultrapassa o limite de estoque. Confira o valor informado.',
    CATALOG_DUPLICATE:'Este ISBN já está cadastrado. Localize o livro existente no catálogo.',
    CATALOG_NOT_FOUND:'Livro não encontrado. Atualize o catálogo e consulte novamente.',
    CATALOG_STOCK_HISTORY:'Este livro já tem movimentações de estoque. Use a operação de ajuste para corrigir o saldo.',
    NOTIFICATION_NOT_FOUND:'Notificação não encontrada. Atualize a lista para conferir as notificações atuais.',
    NICHE_NOT_FOUND:'Nicho não encontrado. Atualize a lista e escolha um nicho disponível.',
    NICHE_DUPLICATE:'Já existe um nicho com este nome. Confira também os nichos desativados.',
    SCHEDULE_NOT_FOUND:'Escala não encontrada. Atualize a lista e consulte novamente.',
    SCHEDULE_EMPLOYEE_UNAVAILABLE:'A pessoa selecionada não está disponível para esta escala. Atualize a equipe e escolha novamente.',
    SCHEDULE_OVERLAP:'Esta pessoa já tem uma escala nesse horário. Confira as datas e os horários.',
    KEY_MANAGEMENT_LAST_KEY:'Esta é sua última forma de confirmação pelo aparelho. Cadastre outra antes de remover esta.',
    KEY_MANAGEMENT_RATE_LIMITED:'Você fez várias solicitações de alteração dos aparelhos. Aguarde antes de tentar novamente.',
    EMAIL_CHANGE_RATE_LIMITED:'Uma alteração de e-mail foi solicitada há pouco. Aguarde antes de solicitar outro código.',
    EMAIL_CHANGE_DELIVERY:'Não conseguimos confirmar o envio do código. Confira o endereço e tente novamente em alguns instantes.',
    EMAIL_CHANGE_REJECTED:'Não foi possível validar o código. Confira o código mais recente e sua validade.',
    PERSONAL_DATA_UNAVAILABLE:'Não conseguimos acessar os dados deste cadastro. Peça ajuda à administração.',
    UPSTREAM_TIMEOUT:'A confirmação demorou mais que o esperado. Confira o resultado antes de repetir a ação.',
    UPSTREAM_UNAVAILABLE:'O serviço está indisponível no momento. Aguarde alguns instantes e confira o resultado antes de tentar novamente.',
    UPSTREAM_UNTRUSTED:'Não conseguimos validar a resposta do serviço. Confira o resultado antes de repetir a ação. Se continuar, peça ajuda à administração.',
  });
  const fields = Object.freeze({cpf:'CPF inválido. Confira os 11 números digitados.',email:'E-mail inválido. Confira o endereço digitado.',phone:'Telefone inválido. Informe o DDD e o número.',name:'Informe um nome válido.',postalCode:'CEP inválido. Informe oito números.',state:'Estado inválido. Escolha uma UF válida.',isbn:'ISBN inválido. Confira o número na contracapa do livro.',title:'Informe o título do livro.',priceCents:'Preço inválido. Informe um valor como 45,00.',minimumStock:'Estoque mínimo inválido. Informe um número inteiro de zero a um milhão.',year:'Ano inválido. Informe quatro números ou deixe em branco.',pages:'Quantidade de páginas inválida. Informe um número inteiro.',nicheIds:'Selecione pelo menos um nicho disponível.',date:'Data inválida. Confira o dia, o mês e o ano.',start:'Horário inicial inválido. Informe horas e minutos.',end:'Horário final inválido. Ele precisa ser posterior ao horário inicial.',reason:'Informe um motivo válido para esta alteração.',quantity:'Quantidade inválida. Informe um número inteiro maior que zero.',newStock:'Saldo inválido. Informe um número inteiro de zero a um milhão.',paymentMethod:'Selecione uma forma de pagamento disponível.'});
  const selectors={cpf:'input[id$="-cpf"],#owner-cpf-input',email:'[type="email"]',phone:'[type="tel"]',name:'input[id$="-name"],select[id$="-name"]',postalCode:'input[id$="-postalCode"],select[id$="-postalCode"]',state:'input[id$="-state"],select[id$="-state"]',isbn:'#isbn',title:'#title',priceCents:'#price',minimumStock:'#minimum-stock',year:'#year',pages:'#pages',date:'[type="date"]',start:'input[id$="-start"],select[id$="-start"]',end:'input[id$="-end"],select[id$="-end"]',reason:'textarea[id$="-reason"],input[id$="-reason"]',quantity:'input[id$="-quantity"],select[id$="-quantity"]',newStock:'#new-stock'};
  const marks=new WeakMap();
  function clearMark(input){const mark=marks.get(input);if(!mark)return;input.removeAttribute('aria-invalid');if(mark.previous)input.setAttribute('aria-describedby',mark.previous);else input.removeAttribute('aria-describedby');if(mark.feedback?.textContent===mark.text)mark.feedback.textContent='';input.removeEventListener('input',mark.listener);marks.delete(input);}
  if(typeof document!=='undefined')document.addEventListener('reset',event=>{for(const input of event.target.querySelectorAll?.('[aria-invalid="true"]')||[])clearMark(input);});
  globalThis.LivrariaMessages = Object.freeze({
    highlight(form,error,feedbackId) {
      if (!form || !Object.hasOwn(selectors,error?.field)) return;
      const input=form.querySelector(selectors[error.field]),feedback=document.getElementById(feedbackId);if(!input||!feedback)return;
      if(!marks.has(input)){
        const previous=input.getAttribute('aria-describedby'),listener=()=>clearMark(input);marks.set(input,{previous,listener});
        input.addEventListener('input',listener,{once:true});
      }
      marks.get(input).text=feedback.textContent;marks.get(input).feedback=feedback;input.setAttribute('aria-invalid','true');
      input.setAttribute('aria-describedby',[marks.get(input).previous,feedbackId].filter(Boolean).join(' '));
      queueMicrotask(()=>{if(input.getAttribute('aria-invalid')==='true'&&!input.disabled)input.focus();});
    },
    describe(error) {
      const code=typeof error?.code==='string'?error.code.replace(/^WORKSPACE_/,''):'';
      if (['UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE','UPSTREAM_UNTRUSTED','INTERNAL'].includes(code) && error?.readOnly===true) return 'Não conseguimos carregar os dados agora. Aguarde alguns instantes e atualize a consulta. Se continuar, peça ajuda à administração.';
      if (error?.name==='AbortError') return error.readOnly===true?'A consulta demorou mais que o esperado. Aguarde alguns instantes e atualize a consulta.':'Não recebemos a confirmação no prazo esperado. Confira o resultado antes de enviar novamente.';
      if (Object.hasOwn(codes,code)) return codes[code];
      if (code.startsWith('INVALID_') && Object.hasOwn(fields,error?.field)) return fields[error.field];
      return null;
    },
  });
})();
