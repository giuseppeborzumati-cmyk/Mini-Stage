from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old_manage='''<div id="manage-booking-modal" class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 hidden p-4">\n        <div class="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md border border-indigo-50">'''
new_manage='''<div id="manage-booking-modal" class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 hidden p-3 sm:p-4 overflow-y-auto overscroll-contain">\n        <div class="bg-white p-5 sm:p-6 rounded-2xl shadow-2xl w-full max-w-md border border-indigo-50 max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain my-auto">'''
old_booking='''<div id="booking-modal" class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-50 hidden p-4">\n        <div class="bg-white/95 p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-indigo-50">'''
new_booking='''<div id="booking-modal" class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 hidden p-3 sm:p-4 overflow-y-auto overscroll-contain">\n        <div class="bg-white/95 p-5 sm:p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-indigo-50 max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain my-auto">'''
old_actions='''            <div class="flex justify-end space-x-3 mt-6">\n                <button onclick="window.closeModal()"'''
new_actions='''            <div class="flex justify-end space-x-3 mt-6 sticky bottom-0 z-10 bg-white/95 backdrop-blur-sm pt-3 pb-2 -mx-1 px-1">\n                <button onclick="window.closeModal()"'''
for old,new,name in [(old_manage,new_manage,'manage modal'),(old_booking,new_booking,'booking modal'),(old_actions,new_actions,'booking actions')]:
    if old not in s:
        raise SystemExit(f'Pattern not found: {name}')
    s=s.replace(old,new,1)
s=s.replace('ministage-complete.js?v=20260906d','ministage-complete.js?v=20260906e').replace('ministage-admin-console-v2.js?v=20260906d','ministage-admin-console-v2.js?v=20260906e')
# Current source may still be c/d depending previous deploy; force only final loader tokens if needed.
s=s.replace('ministage-complete.js?v=20260906c','ministage-complete.js?v=20260906e').replace('ministage-admin-console-v2.js?v=20260906c','ministage-admin-console-v2.js?v=20260906e')
p.write_text(s,encoding='utf-8')
print('MOBILE_MODAL_PATCH_OK')
