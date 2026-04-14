// Handles both Capacitor (native APK) and Web Notifications API

const DAILY_HOUR = 20 // 8 PM
const DAILY_MINUTE = 0

export async function requestNotificationPermission() {
  try {
    // Try Capacitor native first
    if (window.Capacitor?.isNativePlatform?.()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const status = await LocalNotifications.requestPermissions()
      return status.display === 'granted'
    }
    // Web Notifications fallback
    if ('Notification' in window) {
      const permission = await Notification.requestPermission()
      return permission === 'granted'
    }
  } catch (e) {
    console.warn('Notification permission error:', e)
  }
  return false
}

export async function scheduleDailyReminder() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')

      // Cancel existing
      await LocalNotifications.cancel({ notifications: [{ id: 1 }] }).catch(() => {})

      // Schedule for today at 20:00, repeat daily
      const now = new Date()
      const scheduledTime = new Date()
      scheduledTime.setHours(DAILY_HOUR, DAILY_MINUTE, 0, 0)

      // If already past 20:00 today, schedule for tomorrow
      if (scheduledTime <= now) {
        scheduledTime.setDate(scheduledTime.getDate() + 1)
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: 1,
            title: '🛒 תקציב סופר',
            body: 'זמן להכניס את הוצאות היום! אל תשכח לתעד את הקניות.',
            schedule: {
              at: scheduledTime,
              repeats: true,
              every: 'day',
            },
            sound: 'default',
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#1d4ed8',
          },
        ],
      })
      return true
    }

    // Web fallback — can only show immediate notification, no reliable daily scheduling
    // We store preference and check on app load
    localStorage.setItem('notifications_enabled', 'true')
    localStorage.setItem('notification_hour', String(DAILY_HOUR))
    return true
  } catch (e) {
    console.warn('Schedule notification error:', e)
    return false
  }
}

export function cancelDailyReminder() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
        LocalNotifications.cancel({ notifications: [{ id: 1 }] })
      })
    }
    localStorage.removeItem('notifications_enabled')
  } catch (e) {}
}

// Called on every web app load to check if we should show reminder
export function checkWebNotificationTime() {
  if (window.Capacitor?.isNativePlatform?.()) return // native handles it
  if (localStorage.getItem('notifications_enabled') !== 'true') return
  if (Notification?.permission !== 'granted') return

  const lastShown = localStorage.getItem('notification_last_shown')
  const today = new Date().toDateString()
  if (lastShown === today) return // already shown today

  const now = new Date()
  if (now.getHours() >= DAILY_HOUR) {
    new Notification('🛒 תקציב סופר', {
      body: 'זמן להכניס את הוצאות היום! אל תשכח לתעד את הקניות.',
      icon: '/vite.svg',
    })
    localStorage.setItem('notification_last_shown', today)
  }
}
