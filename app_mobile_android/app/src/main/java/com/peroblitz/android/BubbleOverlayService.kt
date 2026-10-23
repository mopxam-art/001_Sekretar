package com.peroblitz.android

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.Toast

class BubbleOverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var bubbleView: View
    private var isRecording = false

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        
        // В реальном приложении здесь будет R.layout.bubble_layout
        // Для MVP создадим View программно
        val imageView = ImageView(this)
        // Иконка по умолчанию (микрофон) - позже заменим на перо
        imageView.setImageResource(android.R.drawable.ic_btn_speak_now)
        imageView.setBackgroundColor(android.graphics.Color.parseColor("#aa000000"))
        imageView.setPadding(20, 20, 20, 20)
        bubbleView = imageView

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        )

        params.gravity = Gravity.TOP or Gravity.START
        params.x = 0
        params.y = 300

        windowManager.addView(bubbleView, params)

        bubbleView.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f
            private val CLICK_THRESHOLD = 10f

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        // Начинаем запись
                        startRecording()
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val deltaX = event.rawX - initialTouchX
                        val deltaY = event.rawY - initialTouchY
                        
                        // Если сдвинули далеко, значит это перемещение шарика
                        if (Math.abs(deltaX) > CLICK_THRESHOLD || Math.abs(deltaY) > CLICK_THRESHOLD) {
                            params.x = initialX + deltaX.toInt()
                            params.y = initialY + deltaY.toInt()
                            windowManager.updateViewLayout(bubbleView, params)
                        }
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        // Останавливаем запись
                        stopRecording()
                        return true
                    }
                }
                return false
            }
        })
    }

    private fun startRecording() {
        if (isRecording) return
        isRecording = true
        bubbleView.setBackgroundColor(android.graphics.Color.parseColor("#ff0000"))
        Toast.makeText(this, "Запись начата...", Toast.LENGTH_SHORT).show()
        // TODO: Start AudioCapture and Groq Transcriber
    }

    private fun stopRecording() {
        if (!isRecording) return
        isRecording = false
        bubbleView.setBackgroundColor(android.graphics.Color.parseColor("#aa000000"))
        Toast.makeText(this, "Распознавание...", Toast.LENGTH_SHORT).show()
        // TODO: Stop AudioCapture, send to Groq, pass to AccessibilityService
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::bubbleView.isInitialized) {
            windowManager.removeView(bubbleView)
        }
    }
}
