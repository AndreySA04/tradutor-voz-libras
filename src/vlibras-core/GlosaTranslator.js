import request from 'superagent';

function GlosaTranslator(endpoint) {
  this.endpoint = endpoint;
}

GlosaTranslator.prototype.translate = function (text, domain, callback) {
  const time = 30000;
  let hasTimeout = false;

  const timeout = setTimeout(() => {
    hasTimeout = true;
    callback(undefined, 'timeout_error');
  }, time);

  request.post(this.endpoint, { text: text, domain: domain }).end(
    function (err, response) {
      if (hasTimeout) return;

      clearTimeout(timeout);
      if (err) callback(undefined, err);
      else callback(response.text);
    }
  );
};

export default GlosaTranslator;