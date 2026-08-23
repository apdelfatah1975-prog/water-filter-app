# مراجع ربط WhatsApp Business Platform

تمت مراجعة وثائق Meta الرسمية في 24 أغسطس 2026:

- WhatsApp Cloud API — Get Started: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
  توضح إضافة رقم هاتف تجاري، إعداد خادم Webhook، وإجراءات البدء بالمنصة.
- WhatsApp Webhooks overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
  توضح استخدام نقطة Webhook بديلة لحقول معينة لحساب WhatsApp Business Account أو رقم الهاتف التجاري.
- About the WhatsApp Business Platform: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform
  توضح أن Cloud API تستخدم Graph API للإرسال وWebhooks لاستقبال الأحداث عبر HTTPS/TLS.
- Template fundamentals: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
  توضح أن قوالب الرسائل أصول لحساب WhatsApp Business ويمكن إرسالها عبر Cloud API أو Marketing Messages API.
- Messages webhook reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages
  يوضح أن Webhook للرسائل يغطي رسائل المستخدمين إلى النشاط التجاري وحالات الرسائل المرسلة من النشاط التجاري.

الاستنتاج: تغيير رقم واتساب داخل إعدادات التطبيق يكفي لأزرار التواصل اليدوي، أما إشعار تلقائي عند إنشاء عميل جديد فيحتاج تكامل WhatsApp Cloud API، وقالب رسالة معتمد عند اللزوم، وخادم Webhook/إرسال آمن. لم يتم تعديل التطبيق أو إعداد أي موصل في هذه الخطوة.
