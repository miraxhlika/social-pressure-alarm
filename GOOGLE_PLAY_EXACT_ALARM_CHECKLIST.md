# Google Play exact-alarm release checklist

- Confirm the app's core user-facing function is time-sensitive checkpoint/alarm delivery.
- Declare `SCHEDULE_EXACT_ALARM` use in Play Console before promoting an Android build.
- Verify the in-app timing warning and Settings action on Android 12 and newer.
- Verify reminders still arrive, with possible delay, when exact-alarm access is denied.
- Do not describe this as full-screen alarm takeover or bypassing device notification controls.
