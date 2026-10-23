const { EventEmitter } = require('events');
const activeWin = require('active-win');

/**
 * MeetingDetector - автоматическое определение онлайн-встреч
 *
 * Детектирует Zoom, Google Meet, Microsoft Teams по активному окну
 * Испускает события: 'meeting-detected', 'meeting-ended'
 */
class MeetingDetector extends EventEmitter {
  constructor() {
    super();

    this.isMonitoring = false;
    this.monitorInterval = null;
    this.currentMeeting = null;
    this.lastNotificationTime = 0;
    this.lastMeetingCheckTime = 0; // Для debounce
    this.consecutiveNoMeetingCount = 0; // Счётчик проверок без встречи

    // Паттерны для детектирования встреч
    this.meetingPatterns = [
      // Zoom
      {
        platform: 'Zoom',
        patterns: [
          { type: 'process', match: /zoom/i },
          { type: 'url', match: /zoom\.us/i },
          { type: 'title', match: /zoom meeting/i }
        ]
      },
      // Google Meet
      {
        platform: 'Google Meet',
        patterns: [
          { type: 'url', match: /meet\.google\.com/i },
          { type: 'title', match: /meet\.google\.com/i },
          { type: 'title', match: /google meet/i }
        ]
      },
      // Microsoft Teams
      {
        platform: 'Microsoft Teams',
        patterns: [
          { type: 'process', match: /teams/i },
          { type: 'url', match: /teams\.microsoft\.com/i },
          { type: 'title', match: /microsoft teams/i }
        ]
      },
      // Skype
      {
        platform: 'Skype',
        patterns: [
          { type: 'process', match: /skype/i },
          { type: 'title', match: /skype/i }
        ]
      },
      // Discord (voice channels)
      {
        platform: 'Discord',
        patterns: [
          { type: 'process', match: /discord/i },
          { type: 'title', match: /discord.*voice/i }
        ]
      },
      // Webex
      {
        platform: 'Webex',
        patterns: [
          { type: 'process', match: /webex/i },
          { type: 'url', match: /webex\.com/i },
          { type: 'title', match: /webex/i }
        ]
      },
      // Яндекс Телемост
      {
        platform: 'Яндекс Телемост',
        patterns: [
          { type: 'url', match: /telemost\.yandex\.ru/i },
          { type: 'title', match: /телемост/i },
          { type: 'title', match: /яндекс.*встреча/i }
        ]
      },
      // СберJazz (SaluteJazz)
      {
        platform: 'СберJazz',
        patterns: [
          { type: 'url', match: /jazz\.sber\.ru/i },
          { type: 'url', match: /jazz\.sberbank\.ru/i },
          { type: 'url', match: /salutejazz\.ru/i },
          { type: 'title', match: /salutejazz/i },
          { type: 'title', match: /sberjazz/i },
          { type: 'title', match: /jazz by sber/i }
        ]
      },
      // VK Звонки / VK Calls
      {
        platform: 'VK Звонки',
        patterns: [
          { type: 'url', match: /vk\.com\/call/i },
          { type: 'url', match: /vk\.com\/video/i },
          { type: 'title', match: /vk.*звонок/i },
          { type: 'title', match: /вконтакте.*звонок/i }
        ]
      }
    ];
  }

  /**
   * Начать мониторинг активных окон
   * @param {number} intervalMs - интервал проверки в миллисекундах (по умолчанию 5000)
   */
  start(intervalMs = 5000) {
    if (this.isMonitoring) {
      console.log('⚠️ Meeting detector already running');
      return;
    }

    console.log('🔍 Starting meeting detector...');
    this.isMonitoring = true;

    // Сразу проверяем один раз
    this.checkActiveWindow();

    // Потом проверяем периодически
    this.monitorInterval = setInterval(() => {
      this.checkActiveWindow();
    }, intervalMs);
  }

  /**
   * Остановить мониторинг
   */
  stop() {
    if (!this.isMonitoring) return;

    console.log('🛑 Stopping meeting detector');
    this.isMonitoring = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    // Если была активная встреча - испускаем событие завершения
    if (this.currentMeeting) {
      this.emit('meeting-ended', this.currentMeeting);
      this.currentMeeting = null;
    }
  }

  /**
   * Проверить активное окно на наличие встречи
   */
  async checkActiveWindow() {
    try {
      const window = await activeWin();

      if (!window) {
        // Нет активного окна
        this.handleNoMeeting();
        return;
      }

      // DEBUG: Log every check (uncomment for debugging)
      // console.log('🔍 Active window:', window.owner?.name, '|', window.title?.substring(0, 50), '|', window.url?.substring(0, 50));

      // Проверяем все паттерны
      const detectedMeeting = this.detectMeeting(window);

      if (detectedMeeting) {
        this.handleMeetingDetected(detectedMeeting);
      } else {
        this.handleNoMeeting();
      }

    } catch (error) {
      // Ошибка может возникнуть на некоторых платформах/конфигурациях
      // Просто игнорируем и продолжаем мониторинг
      if (this.isMonitoring) {
        console.warn('⚠️ Meeting detector error:', error.message);
      }
    }
  }

  /**
   * Детектировать встречу по данным окна
   * @param {Object} window - данные активного окна из active-win
   * @returns {Object|null} - информация о детектированной встрече или null
   */
  detectMeeting(window) {
    const { owner, title, url } = window;
    const ownerName = owner?.name || '';
    const processName = owner?.path || '';

    for (const meeting of this.meetingPatterns) {
      for (const pattern of meeting.patterns) {
        let matched = false;

        switch (pattern.type) {
          case 'process':
            matched = pattern.match.test(ownerName) || pattern.match.test(processName);
            break;
          case 'url':
            matched = url && pattern.match.test(url);
            break;
          case 'title':
            matched = title && pattern.match.test(title);
            break;
        }

        if (matched) {
          return {
            platform: meeting.platform,
            title: title || 'Unknown',
            url: url || null,
            process: ownerName,
            detectedAt: Date.now()
          };
        }
      }
    }

    return null;
  }

  /**
   * Обработать обнаружение встречи
   */
  handleMeetingDetected(meetingInfo) {
    const now = Date.now();

    // Сбрасываем счётчик "нет встречи" так как встреча снова обнаружена
    this.consecutiveNoMeetingCount = 0;

    // Если это новая встреча (или прошло достаточно времени с последнего уведомления)
    if (!this.currentMeeting || this.currentMeeting.platform !== meetingInfo.platform) {
      // Защита от спама уведомлениями - не чаще раза в 5 минут
      const NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 минут

      if (now - this.lastNotificationTime > NOTIFICATION_COOLDOWN) {
        console.log('🎥 Meeting detected:', meetingInfo.platform, '-', meetingInfo.title);

        this.emit('meeting-detected', meetingInfo);
        this.lastNotificationTime = now;
      }

      this.currentMeeting = meetingInfo;
    }
  }

  /**
   * Обработать отсутствие встречи
   */
  handleNoMeeting() {
    // Если была активная встреча
    if (this.currentMeeting) {
      this.consecutiveNoMeetingCount++;

      // Только после 3 проверок подряд без встречи (~15 секунд) - считаем что встреча закончилась
      // Это защита от переключения между окнами
      if (this.consecutiveNoMeetingCount >= 3) {
        console.log('👋 Meeting ended:', this.currentMeeting.platform);

        this.emit('meeting-ended', this.currentMeeting);
        this.currentMeeting = null;
        this.consecutiveNoMeetingCount = 0;
      }
    } else {
      // Сбрасываем счётчик если встречи и так нет
      this.consecutiveNoMeetingCount = 0;
    }
  }

  /**
   * Получить текущую активную встречу
   * @returns {Object|null}
   */
  getCurrentMeeting() {
    return this.currentMeeting;
  }

  /**
   * Проверить, идёт ли сейчас встреча
   * @returns {boolean}
   */
  isMeetingActive() {
    return this.currentMeeting !== null;
  }
}

module.exports = MeetingDetector;
