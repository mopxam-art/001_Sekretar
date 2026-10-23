import React, { useState, useEffect, useRef } from 'react';
import './TypingSpeedModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (wpm: number) => void;
}

export default function TypingSpeedModal({ isOpen, onClose, onSave }: Props) {
  const [text, setText] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [wpm, setWpm] = useState<number>(0);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText('');
      setStartTime(null);
      setWpm(0);
      setTimeout(() => {
        textAreaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    
    if (val.length === 1 && !startTime) {
      setStartTime(Date.now());
    }

    if (startTime && val.trim().length > 0) {
      const elapsedMinutes = (Date.now() - startTime) / 60000;
      const wordCount = val.trim().split(/\s+/).length;
      if (elapsedMinutes > 0) {
        setWpm(Math.round(wordCount / elapsedMinutes));
      }
    } else if (val.trim().length === 0) {
      setWpm(0);
      setStartTime(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content typing-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Проверка скорости печати</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        
        <div className="typing-instructions">
          Просто начните печатать текст. Не торопитесь и ни с кем не соревнуйтесь — печатайте в своем обычном, комфортном темпе. Нам нужно определить вашу реальную скорость печати в рабочем режиме. 
          <br/><br/>
          Именно эта скорость будет использоваться, чтобы точно подсчитать, сколько <b>часов своей жизни вы экономите</b>, используя Перо вместо ручного набора. В любой момент, когда почувствуете, что ваша средняя скорость стабилизировалась, можете остановиться и нажать кнопку сохранения.
        </div>

        <div className="typing-area-container">
          <textarea
            ref={textAreaRef}
            className="typing-textarea"
            placeholder="Начните печатать здесь..."
            value={text}
            onChange={handleChange}
          />
        </div>

        <div className="typing-footer">
          <div className="typing-stats">
            <span className="wpm-label">Текущая скорость:</span>
            <span className="wpm-value">{wpm} <span style={{fontSize: '14px', color: 'var(--text-muted)'}}>слов/мин</span></span>
          </div>
          <button 
            className="save-speed-btn" 
            onClick={() => onSave(wpm)}
            disabled={wpm === 0 || text.length < 10}
          >
            Завершить и сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
