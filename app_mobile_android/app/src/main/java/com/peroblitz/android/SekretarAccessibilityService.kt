package com.peroblitz.android

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class SekretarAccessibilityService : AccessibilityService() {

    companion object {
        var instance: SekretarAccessibilityService? = null
            private set
        
        // Ссылка на последнее активное текстовое поле
        var activeTextNode: AccessibilityNodeInfo? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d("Sekretar", "Accessibility Service Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                val node = event.source
                if (node != null && node.isEditable) {
                    Log.d("Sekretar", "Text field focused in package: ${event.packageName}")
                    activeTextNode = node
                    showBubble()
                }
            }
        }
    }

    private fun showBubble() {
        // Запускаем службу плавающего шарика
        val intent = Intent(this, BubbleOverlayService::class.java)
        startService(intent)
    }

    fun hideBubble() {
        // Останавливаем службу шарика, если фокус потерян
        val intent = Intent(this, BubbleOverlayService::class.java)
        stopService(intent)
    }

    /**
     * Вызывается из BubbleOverlayService после того как Groq распознал речь
     */
    fun insertTextAtCursor(text: String) {
        val node = activeTextNode ?: return
        
        if (node.isEditable) {
            val arguments = Bundle()
            arguments.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, 
                text
            )
            val success = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
            Log.d("Sekretar", "Text insertion successful: $success")
        }
    }

    override fun onInterrupt() {
        Log.d("Sekretar", "Accessibility Service Interrupted")
        instance = null
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        hideBubble()
    }
}
