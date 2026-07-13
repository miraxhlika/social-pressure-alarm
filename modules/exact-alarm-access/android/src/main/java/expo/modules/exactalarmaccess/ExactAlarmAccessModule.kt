package expo.modules.exactalarmaccess

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExactAlarmAccessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExactAlarmAccess")

    AsyncFunction("canScheduleExactAlarms") {
      val context = appContext.reactContext ?: return@AsyncFunction false

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@AsyncFunction true
      }

      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.canScheduleExactAlarms()
    }

    AsyncFunction("openExactAlarmSettings") {
      val context = appContext.reactContext ?: return@AsyncFunction false

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@AsyncFunction true
      }

      val intent = Intent(
        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
        Uri.parse("package:${context.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

      context.startActivity(intent)
      true
    }
  }
}
