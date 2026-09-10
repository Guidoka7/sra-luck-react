import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("WEB_PUSH_VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("WEB_PUSH_VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("\nDefina também WEB_PUSH_VAPID_SUBJECT, por exemplo: mailto:admin@empresa.com");
