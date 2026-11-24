import { useMemo, useState } from "react";
import "./EmojiPicker.css";

/**
 * A small emoji picker that ships with the app.
 *
 * R5: emoji missing from the composers. No new
 * dependency was added for it: the palette is a curated list, grouped the way
 * people look for them, with a keyword search over the group, the emoji name
 * and a handful of synonyms.
 *
 * Pure data plus callbacks. The caller owns the text field and its caret, so
 * the same panel serves the comment composer, the conversation composer and
 * the assistant composer without knowing which one it is inside.
 */
const GROUPS: readonly { name: string; keywords: string; emoji: readonly (readonly [string, string])[] }[] = [
  { name: "Smileys", keywords: "smile face happy sad angry", emoji: [
    ["😀", "grinning"], ["😃", "smiley"], ["😄", "smile"], ["😁", "beam"], ["😆", "laughing"], ["😅", "sweat smile"],
    ["🤣", "rofl"], ["😂", "joy"], ["🙂", "slight smile"], ["🙃", "upside down"], ["😉", "wink"], ["😊", "blush"],
    ["😇", "innocent"], ["🥰", "love"], ["😍", "heart eyes"], ["🤩", "star struck"], ["😘", "kiss"], ["😗", "kissing"],
    ["😋", "yum"], ["😛", "tongue"], ["🤪", "zany"], ["🤨", "raised eyebrow"], ["🧐", "monocle"], ["🤓", "nerd"],
    ["😎", "cool"], ["🥳", "party"], ["😏", "smirk"], ["😒", "unamused"], ["😞", "disappointed"], ["😔", "pensive"],
    ["😟", "worried"], ["😕", "confused"], ["🙁", "frown"], ["☹️", "frowning"], ["😣", "persevere"], ["😖", "confounded"],
    ["😫", "tired"], ["😩", "weary"], ["🥺", "pleading"], ["😢", "cry"], ["😭", "sob"], ["😤", "triumph"],
    ["😠", "angry"], ["😡", "rage"], ["🤯", "exploding head"], ["😳", "flushed"], ["🥵", "hot"], ["🥶", "cold"],
    ["😱", "scream"], ["😨", "fearful"], ["😰", "anxious"], ["😥", "sad relieved"], ["😓", "downcast sweat"], ["🤗", "hug"],
    ["🤔", "thinking"], ["🤭", "hand over mouth"], ["🤫", "shush"], ["😶", "no mouth"], ["😐", "neutral"], ["😑", "expressionless"],
    ["😬", "grimace"], ["🙄", "eye roll"], ["😯", "hushed"], ["😴", "sleeping"], ["🤤", "drool"], ["😪", "sleepy"],
    ["😵", "dizzy"], ["🤐", "zipper"], ["🥴", "woozy"], ["🤢", "nauseated"], ["🤮", "vomit"], ["🤧", "sneeze"],
    ["😷", "mask"], ["🤒", "thermometer"], ["🤕", "bandage"], ["🤑", "money mouth"], ["🤠", "cowboy"], ["😈", "smiling devil"],
  ] },
  { name: "People", keywords: "hands body gesture", emoji: [
    ["👋", "wave"], ["🤚", "raised back"], ["✋", "raised hand"], ["🖖", "vulcan"], ["👌", "ok"], ["🤌", "pinched"],
    ["🤏", "pinch"], ["✌️", "victory"], ["🤞", "crossed fingers"], ["🤟", "love you"], ["🤘", "rock on"], ["🤙", "call me"],
    ["👈", "point left"], ["👉", "point right"], ["👆", "point up"], ["👇", "point down"], ["☝️", "index up"], ["👍", "thumbs up"],
    ["👎", "thumbs down"], ["✊", "fist"], ["👊", "punch"], ["🤛", "left fist"], ["🤜", "right fist"], ["👏", "clap"],
    ["🙌", "raised hands"], ["👐", "open hands"], ["🤲", "palms up"], ["🤝", "handshake"], ["🙏", "please"], ["💪", "muscle"],
    ["🫶", "heart hands"], ["👀", "eyes"], ["🧠", "brain"], ["🫡", "salute"], ["🤷", "shrug"], ["🤦", "facepalm"],
  ] },
  { name: "Nature", keywords: "animal plant weather", emoji: [
    ["🐶", "dog"], ["🐱", "cat"], ["🐭", "mouse"], ["🐹", "hamster"], ["🐰", "rabbit"], ["🦊", "fox"],
    ["🐻", "bear"], ["🐼", "panda"], ["🐨", "koala"], ["🐯", "tiger"], ["🦁", "lion"], ["🐮", "cow"],
    ["🐷", "pig"], ["🐸", "frog"], ["🐵", "monkey"], ["🐔", "chicken"], ["🐧", "penguin"], ["🐦", "bird"],
    ["🦋", "butterfly"], ["🐢", "turtle"], ["🐟", "fish"], ["🐬", "dolphin"], ["🐳", "whale"], ["🐝", "bee"],
    ["🌵", "cactus"], ["🌲", "tree"], ["🌳", "deciduous"], ["🌴", "palm"], ["🌱", "seedling"], ["🍀", "clover"],
    ["🌸", "blossom"], ["🌼", "daisy"], ["🌻", "sunflower"], ["🌹", "rose"], ["🌈", "rainbow"], ["☀️", "sun"],
    ["🌤️", "sun cloud"], ["🌧️", "rain"], ["⛈️", "storm"], ["❄️", "snow"], ["🔥", "fire"], ["💧", "drop"],
  ] },
  { name: "Food", keywords: "drink eat", emoji: [
    ["🍎", "apple"], ["🍐", "pear"], ["🍊", "orange"], ["🍋", "lemon"], ["🍌", "banana"], ["🍉", "watermelon"],
    ["🍇", "grapes"], ["🍓", "strawberry"], ["🫐", "blueberries"], ["🍑", "peach"], ["🥭", "mango"], ["🍍", "pineapple"],
    ["🥑", "avocado"], ["🍅", "tomato"], ["🌽", "corn"], ["🥕", "carrot"], ["🍞", "bread"], ["🧀", "cheese"],
    ["🍳", "egg"], ["🍔", "burger"], ["🍟", "fries"], ["🍕", "pizza"], ["🌮", "taco"], ["🍜", "noodles"],
    ["🍣", "sushi"], ["🍩", "donut"], ["🍪", "cookie"], ["🎂", "cake"], ["🍫", "chocolate"], ["🍿", "popcorn"],
    ["☕", "coffee"], ["🍵", "tea"], ["🥤", "cup"], ["🍺", "beer"], ["🍷", "wine"], ["🥛", "milk"],
  ] },
  { name: "Objects", keywords: "thing tool item", emoji: [
    ["⌚", "watch"], ["📱", "phone"], ["💻", "laptop"], ["🖥️", "desktop"], ["⌨️", "keyboard"], ["🖱️", "mouse"],
    ["🎧", "headphones"], ["📷", "camera"], ["🔋", "battery"], ["🔌", "plug"], ["💡", "bulb"], ["🔦", "torch"],
    ["📚", "books"], ["📝", "memo"], ["📌", "pin"], ["📎", "paperclip"], ["✂️", "scissors"], ["🔑", "key"],
    ["🔒", "lock"], ["🔓", "unlock"], ["🔨", "hammer"], ["🛠️", "tools"], ["🧰", "toolbox"], ["🪛", "screwdriver"],
    ["🧲", "magnet"], ["🧪", "test tube"], ["🧬", "dna"], ["🔬", "microscope"], ["🔭", "telescope"], ["💰", "money bag"],
    ["🎁", "gift"], ["🎈", "balloon"], ["🎉", "party popper"], ["🎨", "palette"], ["🎬", "clapper"], ["🎵", "note"],
  ] },
  { name: "Symbols", keywords: "mark sign arrow heart", emoji: [
    ["❤️", "red heart"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"], ["💙", "blue heart"], ["💜", "purple heart"],
    ["🖤", "black heart"], ["🤍", "white heart"], ["💔", "broken heart"], ["💯", "hundred"], ["✅", "check"], ["❌", "cross"],
    ["⚠️", "warning"], ["❗", "exclamation"], ["❓", "question"], ["⭐", "star"], ["🌟", "glowing star"], ["✨", "sparkles"],
    ["⚡", "bolt"], ["💥", "boom"], ["➡️", "right arrow"], ["⬅️", "left arrow"], ["⬆️", "up arrow"], ["⬇️", "down arrow"],
    ["🔄", "refresh"], ["🔁", "repeat"], ["▶️", "play"], ["⏸️", "pause"], ["⏹️", "stop"], ["⏰", "alarm"],
    ["📢", "loudspeaker"], ["🔔", "bell"], ["🔕", "muted bell"], ["🏁", "chequered flag"], ["♻️", "recycle"], ["🆗", "ok button"],
  ] },
];

/** Splice an emoji into a value at the field's selection. Pure, so the
 * composers can restore the caret after React commits the new value. */
export function insertEmoji(value: string, start: number, end: number, emoji: string) {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return { text: value.slice(0, from) + emoji + value.slice(to), caret: from + emoji.length };
}

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  label?: string;
}

export function EmojiPicker({ onPick, label = "Emoji" }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return GROUPS;
    return GROUPS
      .map((group) => ({
        ...group,
        emoji: group.emoji.filter(([glyph, name]) =>
          name.includes(needle) || group.name.toLowerCase().includes(needle)
          || group.keywords.includes(needle) || glyph === needle),
      }))
      .filter((group) => group.emoji.length > 0);
  }, [query]);
  return (
    <div className="fb-emoji-picker" role="group" aria-label={label}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search emoji"
        placeholder="Search emoji"
        className="fb-emoji-search"
        autoComplete="off"
      />
      <div className="fb-emoji-scroll">
        {groups.map((group) => (
          <section key={group.name} aria-label={group.name}>
            <h4>{group.name}</h4>
            <div className="fb-emoji-grid">
              {group.emoji.map(([glyph, name]) => (
                <button
                  key={`${group.name}-${name}`}
                  type="button"
                  className="fb-emoji-cell"
                  aria-label={name}
                  onClick={() => onPick(glyph)}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="fb-emoji-empty" role="status">No emoji match that word.</p>}
      </div>
    </div>
  );
}
