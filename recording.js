(function(){
  'use strict';
  const DB_NAME='yerin-story-recordings';
  const STORE_NAME='audio';
  let dbPromise=null;
  let recorder=null;
  let recorderStream=null;
  let recorderChunks=[];
  let currentAudioUrl='';

  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise(function(resolve,reject){
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=function(){if(!request.result.objectStoreNames.contains(STORE_NAME))request.result.createObjectStore(STORE_NAME)};
      request.onsuccess=function(){resolve(request.result)};
      request.onerror=function(){reject(request.error)};
    });
    return dbPromise;
  }
  async function dbGet(key){const db=await openDb();return new Promise(function(resolve,reject){const request=db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);request.onsuccess=function(){resolve(request.result||null)};request.onerror=function(){reject(request.error)}})}
  async function dbPut(key,value){const db=await openDb();return new Promise(function(resolve,reject){const request=db.transaction(STORE_NAME,'readwrite').objectStore(STORE_NAME).put(value,key);request.onsuccess=function(){resolve()};request.onerror=function(){reject(request.error)}})}
  async function dbDelete(key){const db=await openDb();return new Promise(function(resolve,reject){const request=db.transaction(STORE_NAME,'readwrite').objectStore(STORE_NAME).delete(key);request.onsuccess=function(){resolve()};request.onerror=function(){reject(request.error)}})}

  function optionLabel(cat,item){const labels={fairy:'동화',song:'동요',aesop:'이솝우화',myth:'그리스신화'};return labels[cat]+' · '+named(item[state.lang][0])}
  function buildTargetOptions(){
    const select=$('#recordingTarget');select.innerHTML='';
    Object.keys(STORIES).forEach(function(cat){
      const group=document.createElement('optgroup');group.label={fairy:'동화',song:'동요',aesop:'이솝우화',myth:'그리스신화'}[cat];
      STORIES[cat].forEach(function(item,index){group.appendChild(new Option(optionLabel(cat,item),cat+':'+index))});
      select.appendChild(group);
    });
    select.add(new Option('✍️ 직접 입력','custom'));
    select.value=state.cat+':'+state.index;
    updateRecordingScript();
  }
  function selectedTarget(){
    const value=$('#recordingTarget').value;
    if(value==='custom')return {custom:true,title:($('#customTitle').value||'직접 입력 녹음').trim(),text:$('#recordingScript').value};
    const parts=value.split(':'),cat=parts[0],index=Number(parts[1]),data=STORIES[cat][index][state.lang];
    return {custom:false,cat:cat,index:index,title:named(data[0]),text:named(data[1])};
  }
  function safeName(value){return (value||'예린이-녹음').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,'-').slice(0,70)}
  function selectedStorageKey(){
    const target=selectedTarget();
    if(target.custom)return 'custom-'+safeName(target.title)+'-'+state.lang+'-'+state.age;
    return 'story-'+target.cat+'-'+target.index+'-'+state.lang+'-'+state.age;
  }
  function currentStoryStorageKey(){return 'story-'+state.cat+'-'+state.index+'-'+state.lang+'-'+state.age}
  function updateRecordingScript(){
    const custom=$('#recordingTarget').value==='custom';
    $('#customTitleWrap').hidden=!custom;
    $('#recordingScript').readOnly=!custom;
    if(custom){$('#recordingScript').value=localStorage.getItem('yerin-custom-script')||'';$('#customTitle').value=localStorage.getItem('yerin-custom-title')||''}
    else{$('#recordingScript').value=selectedTarget().text}
    loadSelectedRecording();
  }
  function showStoryView(){
    $('#parentStudio').hidden=true;$('#storyView').hidden=false;$('#storyControls').hidden=false;
    $('#parentStudioTab').classList.remove('active');
  }
  function showStudio(){
    stop();$('#storyView').hidden=true;$('#storyControls').hidden=true;$('#parentStudio').hidden=false;
    $$('.cat').forEach(function(button){button.classList.remove('active')});$('#parentStudioTab').classList.add('active');
    buildTargetOptions();
  }
  function setStatus(message){$('#recordStatus').textContent=message}
  function chooseMimeType(){
    if(!window.MediaRecorder)return '';
    const types=['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm'];
    return types.find(function(type){return MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(type)})||'';
  }
  function extensionFor(type,name){
    const lower=(name||'').toLowerCase();
    if(/\.mp3$/.test(lower)||/mpeg|mp3/.test(type))return 'mp3';
    if(/\.wav$/.test(lower)||/wav/.test(type))return 'wav';
    if(/\.m4a$/.test(lower)||/mp4|m4a|aac/.test(type))return 'm4a';
    return 'webm';
  }
  function releaseAudioUrl(){if(currentAudioUrl){URL.revokeObjectURL(currentAudioUrl);currentAudioUrl=''}}
  function displayAudio(record){
    releaseAudioUrl();
    const has=!!(record&&record.blob);
    $('#audio').hidden=$('#download').hidden=$('#delete').hidden=!has;
    if(!has){$('#audio').pause();$('#audio').removeAttribute('src');return}
    currentAudioUrl=URL.createObjectURL(record.blob);$('#audio').src=currentAudioUrl;$('#audio').dataset.type=record.type||record.blob.type||'';$('#audio').dataset.name=record.name||'';
  }
  async function loadByKey(key){try{const record=await dbGet(key);displayAudio(record);return record}catch(error){setStatus('저장된 녹음을 불러오지 못했어요.');return null}}
  async function loadSelectedRecording(){return loadByKey(selectedStorageKey())}

  window.loadRecording=function(){loadByKey(currentStoryStorageKey())};
  window.removeRecording=async function(){await dbDelete($('#parentStudio').hidden?currentStoryStorageKey():selectedStorageKey());displayAudio(null);setStatus('녹음을 삭제했어요.')};

  async function startOrStopRecording(){
    if(recorder&&recorder.state==='recording'){recorder.stop();return}
    if(!window.isSecureContext){setStatus('녹음은 HTTPS 주소에서만 사용할 수 있어요.');return}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){setStatus('이 브라우저는 녹음을 지원하지 않아요. Safari 또는 Chrome 최신 버전을 사용해 주세요.');return}
    try{
      recorderStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const mimeType=chooseMimeType();recorder=mimeType?new MediaRecorder(recorderStream,{mimeType:mimeType}):new MediaRecorder(recorderStream);
      recorderChunks=[];
      recorder.ondataavailable=function(event){if(event.data&&event.data.size)recorderChunks.push(event.data)};
      recorder.onerror=function(){setStatus('녹음 중 오류가 생겼어요. 다시 시도해 주세요.')};
      recorder.onstop=async function(){
        const type=recorder.mimeType||mimeType||'audio/webm';const blob=new Blob(recorderChunks,{type:type});
        recorderStream.getTracks().forEach(function(track){track.stop()});recorderStream=null;
        $('#record').textContent='● 다시 녹음';
        if(!blob.size){setStatus('녹음된 소리가 없어요. 다시 시도해 주세요.');return}
        const target=selectedTarget(),ext=extensionFor(type,'');
        const record={blob:blob,type:type,name:safeName(target.title)+'.'+ext,title:target.title,script:$('#recordingScript').value,createdAt:new Date().toISOString(),source:'recording'};
        try{await dbPut(selectedStorageKey(),record);displayAudio(record);setStatus('녹음을 이 기기에 저장했어요.')}
        catch(error){setStatus('녹음을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.')}
      };
      recorder.start(500);$('#record').textContent='■ 녹음 끝내기';setStatus('부모님 목소리를 녹음하고 있어요…');
    }catch(error){
      if(error&&error.name==='NotAllowedError')setStatus('마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크를 허용해 주세요.');
      else if(error&&error.name==='NotFoundError')setStatus('사용할 수 있는 마이크를 찾지 못했어요.');
      else setStatus('녹음을 시작하지 못했어요. Safari 또는 Chrome에서 다시 시도해 주세요.');
    }
  }
  async function iosCheck(){
    const checks=[];
    checks.push(window.isSecureContext?'HTTPS 연결 정상':'HTTPS 연결 필요');
    checks.push(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia?'마이크 기능 정상':'마이크 기능 미지원');
    checks.push(window.MediaRecorder?'녹음 기능 정상':'녹음 기능 미지원');
    const type=chooseMimeType();if(type)checks.push('저장 형식 '+extensionFor(type,'' ).toUpperCase());
    setStatus(checks.join(' · '));
    if(window.isSecureContext&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder){
      try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(function(track){track.stop()});setStatus(checks.join(' · ')+' · 마이크 권한 정상')}
      catch(error){setStatus(checks.join(' · ')+' · 마이크 권한을 허용해 주세요.')}
    }
  }
  async function uploadAudio(event){
    const file=event.target.files&&event.target.files[0];if(!file)return;
    const ext=extensionFor(file.type,file.name);
    if(!['mp3','m4a','webm','wav'].includes(ext)){setStatus('MP3, M4A, WebM 또는 WAV 파일만 올릴 수 있어요.');event.target.value='';return}
    if(file.size>60*1024*1024){setStatus('파일이 너무 커요. 60MB 이하 파일을 선택해 주세요.');event.target.value='';return}
    const target=selectedTarget(),record={blob:file,type:file.type||('audio/'+ext),name:file.name,title:target.title,script:$('#recordingScript').value,createdAt:new Date().toISOString(),source:'upload'};
    try{await dbPut(selectedStorageKey(),record);displayAudio(record);setStatus(ext==='mp3'?'MP3 파일을 이 기기에 저장했어요.':'녹음 파일을 이 기기에 저장했어요.')}
    catch(error){setStatus('파일을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.')}
    event.target.value='';
  }
  async function downloadAudio(){
    const record=await dbGet($('#parentStudio').hidden?currentStoryStorageKey():selectedStorageKey());if(!record||!record.blob){setStatus('먼저 녹음하거나 파일을 올려 주세요.');return}
    const ext=extensionFor(record.type,record.name),link=document.createElement('a');link.href=URL.createObjectURL(record.blob);link.download=safeName(record.title||selectedTarget().title)+'.'+ext;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(link.href)},1000);
    setStatus(ext==='mp3'?'MP3 다운로드를 시작했어요.':ext.toUpperCase()+' 녹음 파일 다운로드를 시작했어요.');
  }
  function bindEnhancements(){
    buildTargetOptions();
    $('#parentStudioTab').onclick=showStudio;
    $$('.cat').forEach(function(button){button.addEventListener('click',showStoryView)});
    $('#recordingTarget').onchange=updateRecordingScript;
    $('#customTitle').oninput=function(){localStorage.setItem('yerin-custom-title',this.value)};
    $('#recordingScript').oninput=function(){if($('#recordingTarget').value==='custom')localStorage.setItem('yerin-custom-script',this.value)};
    $('#record').onclick=startOrStopRecording;$('#iosCheck').onclick=iosCheck;$('#audioUpload').onchange=uploadAudio;$('#download').onclick=downloadAudio;$('#delete').onclick=removeRecording;
    $$('.lang').forEach(function(button){button.addEventListener('click',function(){buildTargetOptions()})});
    $('#age').addEventListener('change',function(){if(!$('#parentStudio').hidden)loadSelectedRecording()});
    window.addEventListener('pagehide',function(){if(recorderStream)recorderStream.getTracks().forEach(function(track){track.stop()});releaseAudioUrl()});
  }
  bindEnhancements();
})();
