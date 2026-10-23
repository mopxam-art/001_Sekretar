package com.peroblitz.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class GroqTranscriber(private val apiKey: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Отправка аудио на транскрибацию в Groq Whisper
     */
    suspend fun transcribeAudio(audioFile: File): Result<String> = withContext(Dispatchers.IO) {
        try {
            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("model", "whisper-large-v3-turbo")
                .addFormDataPart("response_format", "json")
                .addFormDataPart("language", "ru") // По дефолту оставляем ru
                .addFormDataPart(
                    "file", 
                    audioFile.name,
                    audioFile.asRequestBody("audio/mp4".toMediaType())
                )
                .build()

            val request = Request.Builder()
                .url("https://gateway.ai.cloudflare.com/v1/a827714c2919fe3299a0f905be2a1f88/peroblitz/groq/openai/v1/audio/transcriptions")
                .addHeader("Authorization", "Bearer $apiKey")
                .post(requestBody)
                .build()

            client.newCall(request).execute().use { response ->
                val responseData = response.body?.string()
                
                if (!response.isSuccessful) {
                    return@withContext Result.failure(Exception("Groq STT Error ${response.code}: $responseData"))
                }
                
                if (responseData != null) {
                    val json = JSONObject(responseData)
                    val rawText = json.optString("text", "")
                    
                    // Простая базовая фильтрация частых галлюцинаций (как в Desktop версии)
                    val lower = rawText.lowercase().trim()
                    if (lower.contains("субтитры сделал") || 
                        lower.contains("продолжение следует") || 
                        lower.contains("dimatorzok")) {
                        return@withContext Result.success("Неразборчивая речь, повторите.")
                    }
                    
                    return@withContext Result.success(rawText)
                }
                Result.failure(Exception("Empty response"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Очистка текста от слов-паразитов через LLM (gemma2)
     */
    suspend fun cleanupText(text: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("model", "gemma2-9b-it")
                put("temperature", 0.1)
                put("max_tokens", 2048)
                
                val messages = org.json.JSONArray()
                
                val systemMessage = JSONObject().apply {
                    put("role", "system")
                    put("content", "Ты помощник для очистки распознанной речи. Убери слова-паразиты, исправь очевидные ошибки. Верни ТОЛЬКО исправленный текст без пояснений.")
                }
                
                val userMessage = JSONObject().apply {
                    put("role", "user")
                    put("content", text)
                }
                
                messages.put(systemMessage)
                messages.put(userMessage)
                put("messages", messages)
            }

            val request = Request.Builder()
                .url("https://gateway.ai.cloudflare.com/v1/a827714c2919fe3299a0f905be2a1f88/peroblitz/groq/openai/v1/chat/completions")
                .addHeader("Authorization", "Bearer $apiKey")
                .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(request).execute().use { response ->
                val responseData = response.body?.string()
                
                if (!response.isSuccessful) {
                    return@withContext Result.failure(Exception("Groq Chat Error: $responseData"))
                }
                
                if (responseData != null) {
                    val json = JSONObject(responseData)
                    val choices = json.optJSONArray("choices")
                    val resultText = choices?.optJSONObject(0)?.optJSONObject("message")?.optString("content", text) ?: text
                    return@withContext Result.success(resultText.trim())
                }
                Result.success(text)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
