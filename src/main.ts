import { columnHeader, getColumnIndexMap, Row, getSheet } from './spreadsheet/remind';
import { Message, sendPushMessage, sendReplyMessage } from './line';
import { addMinutes, format, setYear, subMinutes } from 'date-fns';

export const main = () => {
  console.log('🐛 debug : テスト');
};

/**
 * WebhookからのPOSTリクエストを処理する
 * @param e
 */
export const doPost = (e: GoogleAppsScript.Events.DoPost) => {
  const EVENTS = JSON.parse(e.postData.contents).events;
  for (const event of EVENTS) {
    execute(event);
  }
};

/**
 * イベントを処理する
 * @param event
 */
const execute = (event: any) => {
  const EVENT_TYPE = event.type;
  const REPLY_TOKEN = event.replyToken;
  const USER_ID = event.source.userId;

  if (EVENT_TYPE === 'message') {
    if (event.message.type === 'text') {
      const text = event.message.text;
      // 「登録」で始まるメッセージの場合、リマインドメッセージを登録する
      const matchResult = text.match(/^登録/);
      if (matchResult && matchResult.input === text) {
        add(text, REPLY_TOKEN, USER_ID);
        sendReplyMessage(REPLY_TOKEN, [
          {
            type: 'text',
            text: '登録しました',
          },
        ]);
      } else {
        sendError(REPLY_TOKEN);
      }
    }
  }
};

/**
 * リマインドメッセージをスプレッドシートに登録する
 */
const add = (text: string, replyToken: string, userId: string): void => {
  // 登録 <日時(MM/dd hh:mm)> <メッセージ>の形式であることを確認する
  const reg = /^登録 (\d{1,2}\/\d{1,2} \d{1,2}:\d{1,2}) (.+)$/;
  const validate = reg.test(text);
  if (!validate) {
    sendError(replyToken);
    return;
  }
  const match = text.match(reg);
  // 日時とメッセージを取得
  const dateStr = match?.[1] ?? '';
  const message = match?.[2] ?? '';
  const date = setYear(new Date(dateStr), new Date().getFullYear()); // 今年に設定
  // 有効な日付であることを確認する, 空文字もここで弾けるはず
  if (isNaN(date.getTime())) {
    sendError(replyToken);
    return;
  }
  // 過去日入力を弾く
  const now = new Date();
  if (date < now) {
    sendInvalidDateError(replyToken);
    return;
  }

  addSheet(message, date, userId);
  addCalendar(message, date);
};

const addSheet = (message: string, date: Date, userId: string) => {
  const sheet = getSheet();

  // 列のインデックスを取得
  const columnIndexMap = getColumnIndexMap(sheet);
  // 新しい行を作成して書き込む
  const newRow: Row = Array.from({ length: columnHeader.length }, () => '');
  newRow[columnIndexMap.date] = format(date, 'yyyy/MM/dd HH:mm');
  newRow[columnIndexMap.message] = message ?? '';
  newRow[columnIndexMap.user_id] = userId;
  newRow[columnIndexMap.created_at] = format(new Date(), 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow(newRow);
};

const addCalendar = (message: string, begin: Date) => {
  // カレンダーを開く
  const prop = PropertiesService.getScriptProperties().getProperties();
  const CALENDAR_ID = prop.CALENDAR_ID;
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);

  const end = addMinutes(begin, 30);
  calendar.createEvent(message, begin, end);
};

/**
 * リマインドメッセージを送信する
 * @param replyToken
 */
const sendError = (replyToken: string): void => {
  const messages = [
    {
      type: 'text',
      text: '登録 <日付(月/日 時:分)> <メッセージ>の形式で入力してください',
    },
  ];
  sendReplyMessage(replyToken, messages);
};

const sendInvalidDateError = (replyToken: string): void => {
  const messages = [
    {
      type: 'text',
      text: '過去の日時が入力されています\n未来の日時を入力してください',
    },
  ];
  sendReplyMessage(replyToken, messages);
};

/**
 * リマインドメッセージを送信する
 */
export const remind = () => {
  // スプレッドシートを開く
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = activeSpreadsheet.getSheetByName('remind');
  if (!sheet) {
    throw new Error('sheet not found');
  }

  // 列のインデックスを取得
  const columnIndexMap = getColumnIndexMap(sheet);

  // 今日の日付を取得
  const now = new Date();
  const begin = subMinutes(now, 1);
  const end = new Date(now.getTime());

  console.log(`${format(begin, 'yyyy/MM/dd HH:mm')} 〜 ${format(end, 'yyyy/MM/dd HH:mm')} のリマインドを送信します`);

  // データを取得して、今日の日付のデータを抽出する
  const rows = sheet.getDataRange().getValues();
  type UserId = string;
  // ユーザーごとにメッセージをまとめる
  const userMessagesMap = rows.reduce<Record<UserId, Message[]>>((acc: Record<UserId, Message[]>, row: Row) => {
    const rowDate = row[columnIndexMap.date];
    const targetDate = new Date(rowDate);
    // 今日の日付のデータの場合、メッセージを格納する
    if (begin <= targetDate && targetDate <= end) {
      // 既に同じユーザーに対するメッセージの配列がある場合、メッセージを追加する
      if (acc[row[columnIndexMap.user_id]]) {
        acc[row[columnIndexMap.user_id]].push({
          type: 'text',
          text: row[columnIndexMap.message],
        });
      } else {
        // まだ同じユーザーに対するメッセージの配列がない場合、新しくメッセージの配列を作成する
        acc[row[columnIndexMap.user_id]] = [
          {
            type: 'text',
            text: row[columnIndexMap.message],
          },
        ];
      }
    }
    return acc;
  }, {} as Record<UserId, Message[]>);

  // ユーザーごとにメッセージを送信する
  for (const userId in userMessagesMap) {
    const messages = userMessagesMap[userId];
    sendPushMessage(userId, messages);
  }
};
