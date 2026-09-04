import { now } from './utils.js';
import { logger } from './logger.js';

export async function processNotificationQueue(db,config,{limit=20}={}){
  if(!config.notificationWebhookUrl||!config.notificationWebhookSecret)return {processed:0,skipped:true};
  const pending=db.prepare(`SELECT * FROM notifications WHERE channel<>'IN_APP' AND status IN ('PENDING','FAILED') AND scheduled_at<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND attempts<5 ORDER BY scheduled_at LIMIT ?`).all(now(),now(),limit);
  let processed=0;
  for(const notification of pending){
    try{
      const response=await fetch(config.notificationWebhookUrl,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${config.notificationWebhookSecret}`,'idempotency-key':notification.idempotency_key},body:JSON.stringify({id:notification.id,channel:notification.channel,eventType:notification.event_type,title:notification.title,message:notification.message,payload:JSON.parse(notification.payload||'{}')})});
      if(!response.ok)throw new Error(`provider_status_${response.status}`);
      db.prepare("UPDATE notifications SET status='SENT',sent_at=?,attempts=attempts+1,last_error=NULL WHERE id=?").run(now(),notification.id);processed++;
    }catch(error){const attempts=Number(notification.attempts)+1,next=new Date(Date.now()+Math.min(60,2**attempts)*60_000).toISOString();db.prepare("UPDATE notifications SET status='FAILED',attempts=?,last_error=?,next_attempt_at=? WHERE id=?").run(attempts,String(error.message).slice(0,300),next,notification.id);logger.warn('notification_delivery_failed',{notificationId:notification.id,eventType:notification.event_type,attempts});}
  }
  return {processed,skipped:false};
}
