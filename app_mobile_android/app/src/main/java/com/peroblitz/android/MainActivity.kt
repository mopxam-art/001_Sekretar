package com.peroblitz.android

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var apiKeyInput: EditText
    private lateinit var saveButton: Button
    private lateinit var overlayPermButton: Button
    private lateinit var accessibilityPermButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Создаем UI программно для MVP (без сложных XML)
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(50, 50, 50, 50)
        }

        val title = android.widget.TextView(this).apply {
            text = "Настройки Перо Блиц"
            textSize = 24f
            setPadding(0, 0, 0, 50)
        }
        layout.addView(title)

        apiKeyInput = EditText(this).apply {
            hint = "Введите API ключ Groq"
            setText("gsk_YOUR_GROQ_API_KEY_HERE")
        }
        layout.addView(apiKeyInput)

        saveButton = Button(this).apply {
            text = "Сохранить ключ"
            setOnClickListener {
                val key = apiKeyInput.text.toString()
                if (key.isNotEmpty()) {
                    val prefs = getSharedPreferences("pero_prefs", MODE_PRIVATE)
                    prefs.edit().putString("groq_api_key", key).apply()
                    Toast.makeText(this@MainActivity, "Ключ сохранен!", Toast.LENGTH_SHORT).show()
                }
            }
        }
        layout.addView(saveButton)

        // Кнопки разрешений
        val permTitle = android.widget.TextView(this).apply {
            text = "Системные разрешения"
            textSize = 18f
            setPadding(0, 50, 0, 20)
        }
        layout.addView(permTitle)

        overlayPermButton = Button(this).apply {
            text = "Разрешить плавающее окно"
            setOnClickListener {
                if (!Settings.canDrawOverlays(this@MainActivity)) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                    startActivity(intent)
                } else {
                    Toast.makeText(this@MainActivity, "Уже разрешено", Toast.LENGTH_SHORT).show()
                }
            }
        }
        layout.addView(overlayPermButton)

        accessibilityPermButton = Button(this).apply {
            text = "Включить спец. возможности"
            setOnClickListener {
                val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                startActivity(intent)
                Toast.makeText(this@MainActivity, "Найдите 'Перо Блиц' в списке и включите", Toast.LENGTH_LONG).show()
            }
        }
        layout.addView(accessibilityPermButton)

        setContentView(layout)
    }

    override fun onResume() {
        super.onResume()
        // Обновляем текст кнопок, если разрешения уже выданы
        if (Settings.canDrawOverlays(this)) {
            overlayPermButton.text = "Плавающее окно: РАЗРЕШЕНО"
            overlayPermButton.isEnabled = false
        }
        
        val prefs = getSharedPreferences("pero_prefs", MODE_PRIVATE)
        val savedKey = prefs.getString("groq_api_key", "")
        if (!savedKey.isNullOrEmpty()) {
            apiKeyInput.setText(savedKey)
        }
    }
}
