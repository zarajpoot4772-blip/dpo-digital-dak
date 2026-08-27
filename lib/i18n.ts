export type Language = 'en' | 'ur';

// The layout remains stable in both languages so the document review pane and
// action rail do not jump when a user switches language.
const translations: Array<[string, string]> = ([
  ['Sign in securely →', 'محفوظ سائن اِن کریں →'],
  ['Sign in to your account', 'اپنے اکاؤنٹ میں سائن اِن کریں'],
  ['Advanced Search', 'اعلیٰ تلاش'],
  ['File Management System', 'فائل مینجمنٹ سسٹم'],
  ['DPO Digital Dak', 'ڈی پی او ڈیجیٹل ڈاک'],
  ['Monthly law and order coordination meeting', 'ماہانہ امن و امان رابطہ اجلاس'],
  ['Document versions', 'دستاویز کے ورژن'],
  ['Supporting documents', 'معاون دستاویزات'],
  ['Permanent action history', 'مستقل کارروائی کی تاریخ'],
  ['Registration details', 'رجسٹریشن کی تفصیلات'],
  ['Authorized office personnel only.', 'صرف مجاز دفتری عملہ۔'],
  ['All access and actions are logged.', 'تمام رسائی اور کارروائیاں ریکارڈ کی جاتی ہیں۔'],
  ['Enter your official credentials to continue.', 'جاری رکھنے کے لیے اپنی سرکاری معلومات درج کریں۔'],
  ['By signing in, you acknowledge that activity is monitored and audited.', 'سائن اِن کر کے آپ تسلیم کرتے ہیں کہ سرگرمی کی نگرانی اور آڈٹ کیا جاتا ہے۔'],
  ['Prototype accounts', 'پروٹوٹائپ اکاؤنٹس'],
  ['Secure • Traceable • Accountable', 'محفوظ • قابلِ سراغ • جواب دہ'],
  ['SECURE ACCESS', 'محفوظ رسائی'],
  ['GOVERNMENT OF PUNJAB', 'حکومتِ پنجاب'],
  ['Dashboard', 'ڈیش بورڈ'],
  ['Dak Inbox', 'ڈاک اِن باکس'],
  ['New Dak', 'نئی ڈاک'],
  ['Pending / opened', 'زیرِ التوا / کھولی گئی'],
  ['Pending review', 'جائزے کے لیے زیرِ التوا'],
  ['Pending', 'زیرِ التوا'],
  ['Forwarded', 'ارسال شدہ'],
  ['Sent Back', 'واپس بھیجی گئی'],
  ['Approved', 'منظور شدہ'],
  ['Rejected', 'مسترد شدہ'],
  ['Advanced Search', 'اعلیٰ تلاش'],
  ['Reports', 'رپورٹس'],
  ['Audit Logs', 'آڈٹ لاگز'],
  ['Branches', 'برانچز'],
  ['Signatures', 'دستخط'],
  ['Users', 'صارفین'],
  ['Backups', 'بیک اپ'],
  ['Notifications', 'اطلاعات'],
  ['No notifications', 'کوئی اطلاع نہیں'],
  ['System operational', 'سسٹم فعال ہے'],
  ['Local secure prototype', 'مقامی محفوظ پروٹوٹائپ'],
  ['OVERVIEW', 'جائزہ'],
  ['Good day,', 'خوش آمدید،'],
  ['Here is the current position of official Dak.', 'یہ سرکاری ڈاک کی موجودہ صورتحال ہے۔'],
  ['Recent Dak', 'حالیہ ڈاک'],
  ['Latest files requiring attention', 'توجہ کی ضرورت والی تازہ فائلیں'],
  ['View all →', 'تمام دیکھیں →'],
  ['urgent file', 'ہنگامی فائل'],
  ['Awaiting action in active workflow', 'فعال ورک فلو میں کارروائی کی منتظر'],
  ['Review now', 'ابھی جائزہ لیں'],
  ['Today', 'آج'],
  ['Received today', 'آج موصول شدہ'],
  ['new Dak entries', 'نئی ڈاک اندراجات'],
  ['Audit trail active', 'آڈٹ ٹریل فعال ہے'],
  ['All workflow actions are being recorded.', 'تمام ورک فلو کارروائیاں ریکارڈ ہو رہی ہیں۔'],
  ['DOCUMENT WORKFLOW', 'دستاویز ورک فلو'],
  ['Dak folders by branch', 'برانچ کے لحاظ سے ڈاک فولڈرز'],
  ["Open a folder to see only that branch's Dak.", 'صرف اس برانچ کی ڈاک دیکھنے کے لیے فولڈر کھولیں۔'],
  ['All branches', 'تمام برانچز'],
  ['record', 'ریکارڈ'],
  ['records found', 'ریکارڈ ملے'],
  ['Search records…', 'ریکارڈ تلاش کریں…'],
  ['All priorities', 'تمام ترجیحات'],
  ['Normal', 'عام'],
  ['High', 'اہم'],
  ['Urgent', 'ہنگامی'],
  ['Open ›', 'کھولیں ›'],
  ['This folder has no records matching the current filters.', 'اس فولڈر میں موجودہ فلٹرز سے مطابقت رکھنے والا کوئی ریکارڈ نہیں۔'],
  ['DAK REGISTRATION', 'ڈاک رجسٹریشن'],
  ['New Dak Entry', 'نیا ڈاک اندراج'],
  ['Diary & receipt', 'ڈائری اور وصولی'],
  ['Correspondence details', 'خط و کتابت کی تفصیلات'],
  ['Original documents', 'اصل دستاویزات'],
  ['Register & assign Dak', 'ڈاک رجسٹر اور تفویض کریں'],
  ['Clear form', 'فارم صاف کریں'],
  ['Select one or multiple Dak files', 'ایک یا متعدد ڈاک فائلیں منتخب کریں'],
  ['File details', 'فائل کی تفصیلات'],
  ['History', 'تاریخ'],
  ['Document', 'دستاویز'],
  ['Previous', 'پچھلی'],
  ['Next', 'اگلی'],
  ['Full screen ↗', 'مکمل اسکرین ↗'],
  ['Download copy ↗', 'کاپی ڈاؤن لوڈ کریں ↗'],
  ['Print copy ↗', 'کاپی پرنٹ کریں ↗'],
  ['Take action', 'کارروائی کریں'],
  ['AUTHORIZED ACTIONS', 'مجاز کارروائیاں'],
  ['Each action is timestamped and permanently audited.', 'ہر کارروائی وقت کے ساتھ مستقل آڈٹ میں محفوظ ہوتی ہے۔'],
  ['Approve', 'منظور کریں'],
  ['Reject', 'مسترد کریں'],
  ['Forward', 'آگے بھیجیں'],
  ['Reassign', 'دوبارہ تفویض کریں'],
  ['Send back', 'واپس بھیجیں'],
  ['Add remarks', 'ریمارکس شامل کریں'],
  ['Archive', 'محفوظ کریں'],
  ['CURRENT CUSTODIAN', 'موجودہ ذمہ دار'],
  ['Approve official file', 'سرکاری فائل منظور کریں'],
  ['Reject official file', 'سرکاری فائل مسترد کریں'],
  ['Forward official file', 'سرکاری فائل آگے بھیجیں'],
  ['Cancel', 'منسوخ کریں'],
  ['Confirm approve', 'منظوری کی تصدیق کریں'],
  ['Confirm reject', 'مسترد کرنے کی تصدیق کریں'],
  ['Confirm forward', 'ارسال کی تصدیق کریں'],
  ['DATA PROTECTION', 'ڈیٹا تحفظ'],
  ['Backup & Restore', 'بیک اپ اور بحالی'],
  ['Download backup', 'بیک اپ ڈاؤن لوڈ کریں'],
  ['Restore backup', 'بیک اپ بحال کریں'],
  ['Download full backup ZIP', 'مکمل بیک اپ ZIP ڈاؤن لوڈ کریں'],
  ['Restore selected backup', 'منتخب بیک اپ بحال کریں'],
  ['ACCESS CONTROL', 'رسائی کنٹرول'],
  ['User Management', 'صارفین کا انتظام'],
  ['Reset password', 'پاس ورڈ ری سیٹ کریں'],
  ['Change password', 'پاس ورڈ تبدیل کریں'],
  ['MANAGEMENT INFORMATION', 'انتظامی معلومات'],
  ['Dak Reports', 'ڈاک رپورٹس'],
  ['Export CSV', 'CSV برآمد کریں'],
  ['Refresh report', 'رپورٹ تازہ کریں'],
  ['Rebuild text index', 'متن انڈیکس دوبارہ بنائیں'],
  ['No Dak records match these filters.', 'ان فلٹرز سے کوئی ڈاک ریکارڈ مطابقت نہیں رکھتا۔'],
  ['Keyword', 'کلیدی لفظ'],
  ['Status', 'حیثیت'],
  ['Branch', 'برانچ'],
  ['Assigned to', 'تفویض شدہ'],
  ['Confidentiality', 'رازداری'],
  ['Received from', 'وصولی شروع'],
  ['Received to', 'وصولی اختتام'],
  ['Search records', 'ریکارڈ تلاش کریں'],
  ['Clear', 'صاف کریں'],
  ['No data for these filters.', 'ان فلٹرز کے لیے کوئی ڈیٹا نہیں۔']
] as Array<[string, string]>).sort((a, b) => b[0].length - a[0].length);

const originalText = new WeakMap<Text, string>();
const lastRenderedText = new WeakMap<Text, string>();

export function translateText(value: string, language: Language) {
  if (language === 'en') return value;
  let result = value;
  for (const [english, urdu] of translations) result = result.replaceAll(english, urdu);
  return result;
}

export function localizeElement(root: HTMLElement, language: Language) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    const parent = text.parentElement;
    if (parent && !parent.closest('script,style,noscript,[data-no-translate]')) nodes.push(text);
  }
  for (const node of nodes) {
    const currentValue = node.nodeValue || '';
    const previousRender = lastRenderedText.get(node);
    let source = originalText.get(node);
    if (source === undefined || (previousRender !== undefined && currentValue !== previousRender && currentValue !== translateText(source, 'ur'))) {
      source = currentValue;
      originalText.set(node, source);
    }
    const next = translateText(source, language);
    if (currentValue !== next) node.nodeValue = next;
    lastRenderedText.set(node, next);
  }
}
