import { EventEmitter } from 'events';
function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: { value: ctor, enumerable: false, writable: true, configurable: true }
  });
}

const GAME_OBJECT = "PlayerManager";
const EMOTION_OBJECT = "EmotionBridge";
const CUSTOMIZATION_OBJECT = "CustomizationBridge";

function PlayerManagerAdapter() {
  if (PlayerManagerAdapter.instance) return PlayerManagerAdapter.instance;

  this.subtitle = true;
  this.currentBaseUrl = "";

  this.on(
    "load",
    function () {
      this._send("initRandomAnimationsProcess");
    }.bind(this)
  );

  PlayerManagerAdapter.instance = this;
}

inherits(PlayerManagerAdapter, EventEmitter);

PlayerManagerAdapter.prototype.setPlayerReference = function (player) {
  this.player = player;
};

PlayerManagerAdapter.prototype._send = function (method, params) {
  this.player.SendMessage(GAME_OBJECT, method, params);
};

PlayerManagerAdapter.prototype.applyEmotion = function (action, intensity) {
  this.player.SendMessage(EMOTION_OBJECT, action, intensity);
};

PlayerManagerAdapter.prototype.play = function (glosa) {
  if (glosa) this._send("playNow", glosa);
  else this._send("setPauseState", 0);
};

PlayerManagerAdapter.prototype.setPersonalization = function (personalization) {
  this.player.SendMessage(CUSTOMIZATION_OBJECT, "setURL", personalization);
};

PlayerManagerAdapter.prototype.pause = function () {
  this._send("setPauseState", 1);
};

PlayerManagerAdapter.prototype.stop = function () {
  this._send("stopAll");
};

PlayerManagerAdapter.prototype.setSpeed = function (speed) {
  this._send("setSlider", speed);
};

PlayerManagerAdapter.prototype.toggleSubtitle = function () {
  this.subtitle = !this.subtitle;
  this._send("setSubtitlesState", toInt(this.subtitle));
};

PlayerManagerAdapter.prototype.playWellcome = function () {
  this._send("playWellcome");
};

PlayerManagerAdapter.prototype.changeAvatar = function (avatarName) {
  this._send("Change", avatarName);
};

PlayerManagerAdapter.prototype.setBaseUrl = function (url) {
  this._send("setBaseUrl", url);
  this.currentBaseUrl = url;
};

window.onLoadPlayer = function () {
  PlayerManagerAdapter.instance.emit("load");
};

window.updateProgress = function (progress) {
  PlayerManagerAdapter.instance.emit("progress", progress);
};

window.onPlayingStateChange = function (
  isPlaying,
  isPaused,
  isPlayingIntervalAnimation,
  isLoading,
  isRepeatable
) {
  PlayerManagerAdapter.instance.emit(
    "stateChange",
    toBoolean(isPlaying),
    toBoolean(isPaused),
    toBoolean(isLoading)
  );
};

window.CounterGloss = function (counter, glosaLenght) {
  PlayerManagerAdapter.instance.emit("CounterGloss", counter, glosaLenght);
};

window.GetAvatar = function (avatar) {
  PlayerManagerAdapter.instance.emit("GetAvatar", avatar);
};

window.FinishWelcome = function (bool) {
  PlayerManagerAdapter.instance.emit("FinishWelcome", bool);
};

function toInt(boolean) {
  return !boolean ? 0 : 1;
}

function toBoolean(bool) {
  return bool != "False";
}

export default PlayerManagerAdapter;