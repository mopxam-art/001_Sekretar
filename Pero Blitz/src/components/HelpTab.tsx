import React from 'react';
import './HelpTab.css';

export default function HelpTab() {
  return (
    <div className="tab-container fade-in">
      <div className="tab-header">
        <h1 className="tab-title">Справка</h1>
        <div className="tab-subtitle">О программе Перо Блиц</div>
      </div>
      <div className="help-content">
        <p>Мы транскрибируем, разбираем и вставляем в любое место, где находится курсор в моменте.</p>
        
        <div className="help-section">
          <h3>Как пользоваться:</h3>
          <ul>
            <li>Нажмите горячую клавишу (по умолчанию <strong>Ctrl+Alt</strong>) для начала записи.</li>
            <li>Говорите текст.</li>
            <li>Нажмите ту же клавишу еще раз — текст будет автоматически очищен от слов-паразитов, разбит на абзацы и вставлен туда, где стоял ваш курсор.</li>
          </ul>
        </div>
        
        <div className="help-section">
          <h3>Важные особенности:</h3>
          <ul>
            <li>Программа работает глобально — поверх любых окон.</li>
            <li>История ваших диктовок сохраняется на вкладке «История».</li>
            <li>Если вам нужно изменить горячие клавиши, перейдите в «Настройки».</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
