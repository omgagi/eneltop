const $=id=>document.getElementById(id);
const contactId=new URLSearchParams(location.search).get('contact');
const validContact=/^[0-9a-f-]{36}$/.test(contactId||'')?contactId:'';
let contactTarget=null;
const money=value=>'$'+Number(value).toFixed(2).replace('.',',');
async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo completar la solicitud.');return data}
function message(node,text,error=false){node.hidden=false;node.textContent=text;node.classList.toggle('error',error)}
function loginView(){ $('login').hidden=false;$('account').hidden=true;$('contact-view').hidden=true;$('logout').hidden=true;document.querySelector('footer').hidden=Boolean(validContact);if(validContact){$('login').querySelector('h1').textContent=contactTarget?`Escribe a ${contactTarget.name}`:'Contactar a un miembro';$('login-intro').textContent='Debes ser miembro del ranking para poder contactar a alguien. Accede con el correo que verificaste al pagar.'} }
async function loadContactTarget(){
  if(!validContact)return;
  try{const data=await api('/api/ranking');contactTarget=data.projects.find(project=>project.id===validContact&&project.contactable)||null}catch{}
  if(!contactTarget)return;
  $('contact-title').textContent=`Escribe a ${contactTarget.name}`;
  $('contact-name').textContent=contactTarget.name;
  $('contact-category').textContent=`${contactTarget.category} · miembro del ranking`;
  if(contactTarget.logo){$('contact-logo').src=contactTarget.logo;$('contact-logo').hidden=false;$('contact-logo').onerror=()=>{$('contact-logo').hidden=true}}
}
async function load(){try{const data=await api('/api/account');$('login').hidden=true;$('logout').hidden=false;updatePresence(true).catch(()=>{});if(validContact){$('account').hidden=true;$('contact-view').hidden=false;document.querySelector('footer').hidden=true;$('contact-from').textContent=`Escribes desde ${data.email}. Solo tú verás este correo.`;if(!contactTarget){$('contact-form').hidden=true;message($('contact-notice'),'Este puesto no está disponible para mensajes.',true)}else if(!data.projects.length){$('contact-form').hidden=true;message($('contact-notice'),'Debes ser miembro del ranking para poder contactar a alguien.',true)}else if(data.projects.some(project=>project.id===validContact)){$('contact-form').hidden=true;message($('contact-notice'),'Este puesto ya es tuyo.',true)}else $('contact-text').focus();return}$('contact-view').hidden=true;$('account').hidden=false;document.querySelector('footer').hidden=false;$('account-email').textContent=data.email;const list=$('projects');list.replaceChildren();$('empty').hidden=data.projects.length>0;for(const project of data.projects)list.append(projectCard(project));loadInbox().catch(()=>{message($('threads-empty'),'No se pudieron cargar los mensajes.',true)})}catch{loginView()}}
function projectCard(project){const card=document.createElement('article');card.className='card project-card';const head=document.createElement('div');head.className='project-head';if(project.logo){const img=document.createElement('img');img.src=project.logo;img.alt='Logo actual';head.append(img)}const title=document.createElement('div');const h=document.createElement('h3');h.textContent=project.name;const sub=document.createElement('p');sub.textContent=project.category;title.append(h,sub);head.append(title);if(project.rank){const rank=document.createElement('span');rank.className='rank-pill';rank.textContent=`Puesto #${project.rank}`;head.append(rank)}card.append(head);const layout=document.createElement('div');layout.className='project-layout';const edit=document.createElement('div');edit.className='project-edit';const editTitle=document.createElement('h4');editTitle.textContent='Información del puesto';const editHint=document.createElement('p');editHint.className='hint';editHint.textContent='Corrige el enlace o actualiza la imagen que aparece en el ranking.';edit.append(editTitle,editHint);const actions=document.createElement('aside');actions.className='project-actions';const actionTitle=document.createElement('h4');actionTitle.textContent='Tu posición';const actionHint=document.createElement('p');actionHint.className='hint';actionHint.textContent=`Oferta actual: ${money(project.bid)}`;actions.append(actionTitle,actionHint);layout.append(edit,actions);card.append(layout);
  const form=document.createElement('form');const label=document.createElement('label');label.textContent='URL';const url=document.createElement('input');url.type='url';url.required=true;url.value=project.url;url.maxLength=500;const photoLabel=document.createElement('label');photoLabel.textContent='Actualizar foto o logo';const photo=document.createElement('input');photo.type='file';photo.accept='image/jpeg,image/png,image/webp';const help=document.createElement('small');help.textContent='JPG, PNG o WebP · mínimo 128 × 128 px · máximo 3 MB. La imagen se recorta al centro en formato cuadrado.';const button=document.createElement('button');button.textContent='Guardar cambios';const status=document.createElement('div');status.className='message';status.hidden=true;status.setAttribute('role','status');form.append(label,url,photoLabel,photo,help,button,status);form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;try{const logo=photo.files[0]?await prepareLogo(photo.files[0]):undefined;const body={url:url.value};if(logo)body.logo=logo;const result=await api(`/api/account/projects/${project.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(result.logo&&head.querySelector('img'))head.querySelector('img').src=result.logo;else if(result.logo){const img=document.createElement('img');img.src=result.logo;img.alt='Logo actual';head.prepend(img)}message(status,'Cambios guardados.')}catch(error){message(status,error.message,true)}finally{button.disabled=false}});
  edit.append(form);const link=document.createElement('a');link.className='button';link.href=`/p/${project.id}`;link.textContent='Ver puesto →';actions.append(link);if(project.rank)actions.append(shareBox(project));
  const bidForm=document.createElement('form');bidForm.className='bid-form';const bidLabel=document.createElement('label');bidLabel.textContent=project.rank===1?'Aumentar mi oferta (USD)':'Oferta para llegar al #1 (USD)';const amount=document.createElement('input');amount.type='number';amount.min=(Math.round(project.bid*100)+1)/100;amount.step='0.01';amount.value=Math.max(Number(project.firstPlaceBid)||0,(Math.round(project.bid*100)+1)/100).toFixed(2);amount.required=true;const note=document.createElement('small');note.textContent='Se cobra el importe completo de la nueva oferta. Usa el mismo correo en Dodo Payments para actualizar este puesto.';const submit=document.createElement('button');submit.textContent=project.rank===1?'Aumentar mi oferta →':'Llegar al primer lugar →';const bidStatus=document.createElement('div');bidStatus.className='message';bidStatus.hidden=true;bidStatus.setAttribute('role','status');bidForm.append(bidLabel,amount,note,submit,bidStatus);bidForm.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{const cents=Math.round(Number(amount.value)*100);const fresh=await api('/api/account');const current=fresh.projects.find(item=>item.id===project.id);if(!current)throw new Error('Este puesto ya no está disponible.');const required=Math.round(current.firstPlaceBid*100);if(current.rank!==1&&cents<required){amount.value=(required/100).toFixed(2);throw new Error(`El primer lugar ahora requiere al menos ${money(required/100)}. Revisa la nueva oferta.`)}const result=await api(`/api/account/bid/${project.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cents})});location.assign(result.checkoutUrl)}catch(error){message(bidStatus,error.message,true);submit.disabled=false}});actions.append(bidForm);return card}
function shareBox(project){
  const details=document.createElement('details');details.className='share-box';
  const summary=document.createElement('summary');summary.textContent=`Compartir mi puesto #${project.rank}`;
  const body=document.createElement('div');body.className='share-box-body';
  const image=document.createElement('img');image.alt='Vista previa de tu tarjeta';image.width=1200;image.height=630;
  const actions=document.createElement('div');actions.className='row';
  const instagram=document.createElement('button');instagram.type='button';instagram.textContent='Instagram';
  const facebook=document.createElement('a');facebook.className='button secondary';facebook.textContent='Facebook';facebook.target='_blank';facebook.rel='noopener noreferrer';
  const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='Copiar enlace';
  const download=document.createElement('a');download.className='download';download.download='mi-puesto-eneltop.png';download.textContent='Descargar imagen';
  const status=document.createElement('div');status.className='message';status.hidden=true;status.setAttribute('role','status');
  const url=`https://eneltop.com/p/${project.id}?puesto=${project.rank}&v=${Math.floor(Date.now()/60000)}`;
  const imageUrl=`/api/share/card?id=${encodeURIComponent(project.id)}&puesto=${project.rank}`;
  image.src=imageUrl;download.href=imageUrl;
  facebook.href='https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url);
  let imageFile=null;
  details.addEventListener('toggle',()=>{if(details.open&&!imageFile)fetch(imageUrl,{cache:'no-store'}).then(response=>response.ok?response.blob():null).then(blob=>{if(blob)imageFile=new File([blob],'mi-puesto-eneltop.png',{type:'image/png'})}).catch(()=>{})});
  instagram.addEventListener('click',async()=>{
    if(imageFile&&navigator.share&&navigator.canShare?.({files:[imageFile]})){
      try{await navigator.share({files:[imageFile],title:`Mi puesto #${project.rank} en EnElTop`});return}
      catch(error){if(error.name==='AbortError')return}
    }
    download.click();message(status,'Imagen descargada. Súbela a Instagram para compartirla.');
  });
  copy.addEventListener('click',async()=>{
    try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);else throw new Error('Clipboard unavailable')}
    catch{const input=document.createElement('textarea');input.value=url;input.readOnly=true;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();const copied=document.execCommand('copy');input.remove();if(!copied){message(status,'No se pudo copiar el enlace.',true);return}}
    message(status,'Enlace copiado.');
  });
  actions.append(instagram,facebook,copy,download);body.append(image,actions);details.append(summary,body,status);return details;
}
async function prepareLogo(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>3_000_000)throw new Error('Usa JPG, PNG o WebP de hasta 3 MB.');const objectUrl=URL.createObjectURL(file);try{const img=new Image();img.src=objectUrl;await img.decode();if(img.width<128||img.height<128)throw new Error('La imagen debe medir al menos 128 × 128 px.');const canvas=document.createElement('canvas');canvas.width=canvas.height=192;const size=Math.min(img.width,img.height);canvas.getContext('2d').drawImage(img,(img.width-size)/2,(img.height-size)/2,size,size,0,0,192,192);return canvas.toDataURL('image/png')}finally{URL.revokeObjectURL(objectUrl)}}
let unreadTotal=0;
function showUnreadCount(count){
  unreadTotal=count;
  const alert=$('unread-alert'),badge=$('unread-count');
  alert.hidden=badge.hidden=count===0;
  if(count){alert.textContent=`Tienes ${count} mensaje${count===1?'':'s'} sin leer →`;badge.textContent=count}
  document.title=count?`(${count}) Mi cuenta · EnElTop`:'Mi cuenta · EnElTop';
}
function renderBubble(item){const bubble=document.createElement('div');bubble.className='bubble'+(item.mine?' mine':'');bubble.dataset.messageId=item.id;const body=document.createElement('div');body.textContent=item.text;const time=document.createElement('small');time.textContent=`${item.mine?'Tú':'Miembro'} · ${new Date(item.at).toLocaleString('es-ES')}`;bubble.append(body,time);return bubble}
async function loadInbox(openThreadId=''){
  const data=await api('/api/account/messages');
  showUnreadCount(data.threads.reduce((total,thread)=>total+(thread.unreadCount||0),0));
  const list=$('threads');list.replaceChildren();$('threads-empty').hidden=data.threads.length>0;
  for(const thread of data.threads){
    const box=document.createElement('details');box.className='thread'+(thread.unreadCount?' unread':'');box.dataset.threadId=thread.id;
    const summary=document.createElement('summary');
    const avatar=document.createElement('span');avatar.className='thread-avatar';avatar.textContent=(thread.contactName||'?').charAt(0).toUpperCase();
    if(thread.contactLogo){const image=document.createElement('img');image.src=thread.contactLogo;image.alt='';image.onerror=()=>image.remove();avatar.append(image)}
    const dot=document.createElement('span');dot.className='online-dot';dot.hidden=!thread.contactOnline;dot.setAttribute('aria-label','Conectado');avatar.append(dot);
    const person=document.createElement('span');person.className='thread-person';const name=document.createElement('strong');name.textContent=thread.contactName;const presence=document.createElement('span');presence.className='presence-label'+(thread.contactOnline?' online':'');presence.textContent=thread.contactOnline?'Conectado ahora':`Sobre ${thread.listingName}`;person.append(name,presence);summary.append(avatar,person);
    if(thread.unreadCount){const badge=document.createElement('span');badge.className='thread-unread';badge.textContent=`${thread.unreadCount} nuevo${thread.unreadCount===1?'':'s'}`;summary.append(badge)}
    box.append(summary);
    box.addEventListener('toggle',async()=>{
      if(!box.open||!thread.unreadCount)return;
      try{await api('/api/account/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id})});showUnreadCount(Math.max(0,unreadTotal-thread.unreadCount));thread.unreadCount=0;box.classList.remove('unread');summary.querySelector('.thread-unread')?.remove()}
      catch(error){console.error('No se pudo marcar el mensaje como leído',error)}
    });
    const controls=document.createElement('div');controls.className='chat-controls';
    const reject=document.createElement('button');reject.type='button';reject.className='chat-control';reject.textContent='Rechazar conversación';
    const block=document.createElement('button');block.type='button';block.className='chat-control danger';block.textContent='Bloquear miembro';controls.append(reject,block);box.append(controls);
    const transcript=document.createElement('div');transcript.className='chat-transcript';for(const item of thread.messages)transcript.append(renderBubble(item));box.append(transcript);
    const closed=document.createElement('div');closed.className='chat-closed';closed.hidden=!(thread.rejected||thread.blocked);closed.textContent=thread.blocked?'Has bloqueado a este miembro.':'Esta conversación fue rechazada.';box.append(closed);
    const form=document.createElement('form');form.className='chat-composer';form.hidden=thread.rejected||thread.blocked;const input=document.createElement('textarea');input.required=true;input.maxLength=2000;input.rows=1;input.setAttribute('aria-label','Escribe un mensaje');input.placeholder='Escribe un mensaje';const button=document.createElement('button');button.setAttribute('aria-label','Enviar mensaje');button.textContent='➤';const status=document.createElement('div');status.className='message';status.hidden=true;status.setAttribute('role','status');form.append(input,button,status);
    form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;try{await api('/api/account/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,text:input.value})});await loadInbox(thread.id)}catch(error){message(status,error.message,true)}finally{button.disabled=false}});
    const moderate=async(action)=>{const wording=action==='block'?'bloquear a este miembro':'rechazar y cerrar esta conversación';if(!confirm(`¿Quieres ${wording}?`))return;try{await api('/api/account/messages/moderate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id,action})});await loadInbox(thread.id)}catch(error){alert(error.message)}};
    reject.addEventListener('click',()=>moderate('reject'));block.addEventListener('click',()=>moderate('block'));
    box.append(form);list.append(box);if(thread.id===openThreadId){box.open=true;requestAnimationFrame(()=>{transcript.scrollTop=transcript.scrollHeight})}
  }
}
async function refreshInbox(){
  if($('account').hidden||document.hidden)return;
  const openBoxes=[...document.querySelectorAll('.thread[open]')];
  if(!openBoxes.length)return loadInbox();
  const data=await api('/api/account/messages');
  for(const box of openBoxes){
    const thread=data.threads.find(item=>item.id===box.dataset.threadId);
    if(!thread)continue;
    const dot=box.querySelector('.online-dot'),presence=box.querySelector('.presence-label');
    dot.hidden=!thread.contactOnline;presence.classList.toggle('online',thread.contactOnline);
    presence.textContent=thread.contactOnline?'Conectado ahora':`Sobre ${thread.listingName}`;
    const known=new Set([...box.querySelectorAll('[data-message-id]')].map(item=>item.dataset.messageId));
    const transcript=box.querySelector('.chat-transcript');
    for(const item of thread.messages)if(!known.has(item.id))transcript.append(renderBubble(item));
    if(thread.messages.some(item=>!known.has(item.id)))transcript.scrollTop=transcript.scrollHeight;
    if(thread.unreadCount){
      await api('/api/account/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:thread.id})});
      thread.unreadCount=0;box.classList.remove('unread');box.querySelector('.thread-unread')?.remove();
    }
  }
  showUnreadCount(data.threads.reduce((total,thread)=>total+(thread.unreadCount||0),0));
}
setInterval(()=>refreshInbox().catch(console.error),8000);
async function updatePresence(active){
  await api('/api/account/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});
}
setInterval(()=>{if(!$('logout').hidden&&!document.hidden)updatePresence(true).catch(()=>{})},15000);
document.addEventListener('visibilitychange',()=>{if(!$('logout').hidden)updatePresence(!document.hidden).catch(()=>{})});
window.addEventListener('pagehide',()=>{if(!$('logout').hidden)fetch('/api/account/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"active":false}',credentials:'same-origin',keepalive:true}).catch(()=>{})});
$('contact-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api('/api/account/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId:validContact,text:$('contact-text').value})});$('contact-form').hidden=true;$('contact-done').hidden=false;$('contact-done-text').textContent=`Tu mensaje está en el inbox del propietario de ${contactTarget?.name||'este puesto'}. Le enviaremos un aviso por correo.`}catch(error){message($('contact-status'),error.message,true)}finally{button.disabled=false}});
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{await api('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value,contact:validContact})});message($('login-message'),'Te enviamos un enlace de acceso. Revisa tu correo.')}catch(error){message($('login-message'),error.message,true)}finally{button.disabled=false}});
$('logout').addEventListener('click',async()=>{const button=$('logout');button.disabled=true;try{await updatePresence(false).catch(()=>{});await api('/api/auth/logout',{method:'POST'});location.assign('/')}catch(error){button.disabled=false;alert(`No se pudo cerrar la sesión: ${error.message}`)}});
$('recovery-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const url=new URL($('recovery-url').value),orderId=url.pathname.match(/^\/p\/([0-9a-f-]{36})\/?$/i)?.[1];if(!['eneltop.com','www.eneltop.com'].includes(url.hostname)||!orderId)throw new Error('Introduce el enlace público de tu puesto en EnElTop.');await api('/api/account/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,note:$('recovery-note').value})});message($('recovery-message'),'Solicitud recibida. Revisaremos el pago antes de cambiar el correo.')}catch(error){message($('recovery-message'),error.message,true)}finally{button.disabled=false}});
(async()=>{await loadContactTarget();const token=new URLSearchParams(location.search).get('token');if(token){history.replaceState(null,'',validContact?`/cuenta/?contact=${validContact}`:'/cuenta/');try{await api(`/api/auth/verify?token=${encodeURIComponent(token)}`,{method:'POST'})}catch(error){message($('login-message'),error.message,true)}}await load()})();
