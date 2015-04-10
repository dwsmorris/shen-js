Shen = (function() {
  var id = 0;

  function Shenvm() {
    this.id = id++;
    this.sp = 0;
    this.nargs = 0;
    this.reg = Array(1024);
    this.start = undefined;
    this.pc = undefined;
    this.ret = undefined;
    this.error_handlers = [];
    this.threads = [];
  }

  Shenvm.prototype.toString = function() {
    return "[object Shenvm " + id + "]";
  };

  Shenvm.prototype.glob = {};
  Shenvm.prototype.fns = {};
  Shenvm.prototype.nsteps = 10;
  Shenvm.prototype.glob = {
    "*language*": "Javascript",
    "*implementation*": "cli",
    "*port*": "17.2.1",
    "*porters*": "Ramil Farkhshatov",
    "*home-directory*": "",
    "js.show-error": false,
    "js.show-error-stack": false
  };

  Shenvm.prototype.Tag = function Tag(name) {
    if (!(this instanceof Tag))
      return new Tag(name);
    this.name = name;
  };

  Shenvm.prototype.Tag.prototype.toString = function() {
    return "[object Shen.Tag " + this.name + "]";
  };

  Shenvm.prototype.Func = function Func(name, arity, fn, vars) {
    if (!(this instanceof Func))
      return new Func(name, arity, fn, vars);
    this.name = name;
    this.arity = arity;
    this.fn = fn;
    this.vars = vars || [];
  };

  Shenvm.prototype.Sym = function Sym(str) {
    if (!(this instanceof Sym))
      return new Sym(str);
    this.str = str;
  };

  Shenvm.prototype.Cons = function Cons(head, tail) {
    if (!(this instanceof Cons))
      return new Cons(head, tail);
    this.head = head;
    this.tail = tail;
  };

  Shenvm.prototype.Stream = function Stream(dir, fn, close) {
    if (!(this instanceof Stream))
      return new Stream(dir, fn, close);
    this.dir = dir || "";
    this.close = close || (function(vm) {});
    this.read_byte = function(vm) {
      return vm.error("read-byte: Wrong stream type.");
    };
    this.write_byte = function(vm) {
      vm.error("write-byte: Wrong stream type.");
    };
    switch (dir) {
    case "r": this.read_byte = fn; break;
    case "w": this.write_byte = fn; break;
    case "rw":
    case "wr":
      this.in = fn[0];
      this.out = fn[1];
      this.read_byte = function(vm) {return this.in.read_byte(vm);};
      this.write_byte = function(vm) {this.in.write_byte(vm);};
      this.close = function() {
        this.in.close(vm);
        this.out.close(vm);
      };
    }
  };

  Shenvm.prototype.fail_obj = new Shenvm.prototype.Tag("fail_obj");
  Shenvm.prototype.interrupt_obj = new Shenvm.prototype.Tag("interrupt_obj");

  Shenvm.prototype.clone = function() {
    var obj = new this.constructor(),
        keys = ["io", "eval_str", "run"],
        key;
    for (var i = 0; i < keys.length; ++i) {
      key = keys[i];
      obj[key] = this[key];
    }
    return obj;
  };

  Shenvm.prototype.handle_exception = function(e) {
    var err_handler = this.error_handlers.pop();
    this.wipe_stack(0);
    this.sp = err_handler.sp;
    this.next = err_handler.next;
    return this.call_function(err_handler.fn, [e]);
  };

  Shenvm.prototype.push_error_handler = function(e) {
    this.error_handlers.push({sp: this.sp, next: this.next, fn: e});
  };

  Shenvm.prototype.interrupt = function() {
    throw this.interrupt_obj;
  };

  Shenvm.prototype.resume = function(value) {
    this.ret = value || true;
    this.run();
  };

  Shenvm.prototype.run = function() {
    throw new Error("Call Shen.init first!");
  };

  Shenvm.prototype.run_loop = function() {
    var start = this.start;
    while (start) {
      try {
        var pc = start;
        start = null;
        while (pc) {
          if (this.dump_state_enabled)
            this.dump_state({pc: pc});
          pc = pc(this);
        }
      } catch (e) {
        if (this.is_true(this.glob["js.show-error"]))
          this.io.puts("# err: " + e + "\n");
        if (e !== this.interrupt_obj) {
          if (this.error_handlers.length > 0)
            start = this.handle_exception(e);
          else
            throw e;
        } else {
          this.start = this.next;
          break;
        }
      }
    }
  };

  Shenvm.prototype.run_step = function() {
    try {
      var m = 200;
      var pc = this.start;
      while (pc && m--)
        pc = pc(this);
      this.start = pc;
    } catch (e) {
      if (this.is_true(this.glob["js.show-error"]))
        this.io.puts("# err: " + e + "\n");
      if (e !== this.interrupt_obj) {
        if (this.error_handlers.length > 0)
          this.start = this.handle_exception(e);
        else {
          cancelInterval(this.thread);
          throw e;
        }
      } else {
        this.start = this.next;
        cancelInterval(this.thread);
      }
    }
  };

  Shenvm.prototype.run_interval = function() {
    if (this.thread)
      cancelInterval(this.thread);
    this.thread = setInterval(this.run_step.bind(this), this.step_interval_ms);
  };

  Shenvm.prototype.call_function = function(proc, args) {
    var n = args.length;
    var reg = this.reg;
    n2 = 0;
    if (proc instanceof this.Func)
      n2 = proc.vars.length;
    for (var i = this.sp, j = n - 1; j >= 0; ++i, --j)
      reg[i] = args[j];
    i = this.sp + n;
    if (proc instanceof this.Func) {
      fn = proc.fn;
      var closure_vars = proc.vars;
      for (var j = 0; j < n2; ++i, ++j)
        reg[i] = closure_vars[j];
    } else if (typeof(proc) == "function")
      fn = proc;
    else
      throw new Error("" + proc + " is not a function");
    this.nargs = n + n2;
    return fn;
  };

  Shenvm.prototype.find_func = function(name) {
    if (name instanceof this.Sym)
      name = name.str;
    var ret = this.fns[name];
    if (ret === undefined)
      return this.error("No such function: " + name);
    return ret;
  };

  Shenvm.prototype.ensure_func = function(fn) {
    if (fn instanceof this.Sym)
      return this.find_func(fn.str);
    return fn;
  };

  Shenvm.prototype.call = function(proc, args) {
    if (typeof(proc) === "string")
      proc = this.find_func(proc);

    // DBG
    this.reg = Array(1024);

    this.next = null;
    this.start = this.call_function(proc, args);
    this.run();
    var r = this.ret;
    this.ret = undefined;

    // DBG
    if (this.sp < 0) 
      this.error("sp < 0");

    return r;
  };

  Shenvm.prototype.put_closure_args = function(closure) {
    var vars = closure.vars;
    if (vars && vars.length) {
      var n = vars.length;
      var i = this.sp + this.nargs;
      var reg = this.reg;
      for (var j = 0; j < n; ++i, ++j)
        reg[i] = vars[j];
      this.nargs += vars.length;
    }
  };

  Shenvm.prototype.equal_boolean = function(b, x) {
    return ((x instanceof this.Sym)
            && ((x.str == "true" && b === true)
                || (x.str == "false" && b === false)));
  };

  Shenvm.prototype.equal_function = function(f, x) {
    return (x instanceof this.Sym) && x.str == f.name;
  };

  Shenvm.prototype.is_array_equal = function(x, y) {
    if (x.length != y.length)
      return false;
    var n = x.length;
    for (var i = 0; i < n; ++i)
      if (!this.is_equal(x[i], y[i]))
        return false;
    return true;
  }

  Shenvm.prototype.is_stream_equal = function(x, y) {
    return x.dir === y.dir && x.read_byte === y.read_byte
           && x.write_byte === y.write_byte && x.close === y.close;
  };

  Shenvm.prototype.trace = function(name) {
    var fn = this[name];
    function tostr(x) {
      return this.xstr(x);
    };
    var replaced = function() {
      var args = Array.prototype.slice.call(arguments);
      this.io.puts("(" + name + " " + args.map(tostr).join(" ") + ")\n");
      var ret = fn.apply(this, arguments);
      this.io.puts("" + name + " => " + this.xstr(ret) + "\n");
      return ret;
    };
    replaced.old = fn;
    this[name] = replaced;
  };

  Shenvm.prototype.untrace = function(name) {
    var fn = this[name];
    if (typeof(fn) === "function" && fn.old) {
      this[name] = fn.old;
    }
  };

  Shenvm.prototype.is_equal = function(x, y) {
    if (x === y)
      return true;
    if ((x instanceof Array) && (y instanceof Array))
      return this.is_array_equal(x, y);
    if ((x instanceof this.Sym) && (y instanceof this.Sym))
      return x.str === y.str;
    if (typeof(x) === "boolean" && this.equal_boolean(x, y))
      return true;
    if (typeof(y) === "boolean" && this.equal_boolean(y, x))
      return true;
    if ((x instanceof this.Cons) && (y instanceof this.Cons))
      return this.is_equal(x.head, y.head) && this.is_equal(x.tail, y.tail);
    if ((x instanceof this.Func) && (y instanceof this.Func))
      return x.fn == y.fn && x.arity == y.arity
             && this.is_array_equal(x.vars, y.vars);
    if (this.equal_function(x, y) || this.equal_function(y, x))
      return true;
    if ((x instanceof this.Stream) && (y instanceof this.Stream))
      return this.is_stream_equal(x, y);
    if ((x instanceof this.Func) && (y instanceof this.Sym) && !x.vars.length
        && x.name === y.str)
      return true;
    if ((y instanceof this.Func) && (x instanceof this.Sym) && !y.vars.length
        && y.name === x.str)
      return true;
    return false;
  };

  Shenvm.prototype.is_empty = function(x) {
    return ((x instanceof Array) && !x.length);
  };

  Shenvm.prototype.is_bool = function(x) {
    return (typeof(x) == "boolean")
           || ((x instanceof this.Sym)
               && (x.str === "true" || x.str === "false"));
  };

  Shenvm.prototype.is_vector = function(x) {
    return (x instanceof Array) && x[0] > 0;
  };

  Shenvm.prototype.is_absvector = function(x) {
    return (x instanceof Array) && x.length > 0;
  };

  Shenvm.prototype.absvector = function(n) {
    var ret = new Array(n);
    for (var i = 0; i < n; ++i)
      ret[i] = this.fail_obj;
    return ret;
  };

  Shenvm.prototype.is_true = function(x) {
    return x != false || ((x instanceof this.Sym) && (x.str != "false"));
  };

  Shenvm.prototype.absvector_ref = function(x, i) {
    if (x.length <= i || i < 0)
      this.error("out of range");
    return x[i];
  };

  Shenvm.prototype.absvector_set = function(x, i, v) {
    if (x.length <= i || i < 0)
      this.error("out of range");
    x[i] = v;
    return x;
  };

  Shenvm.prototype.value = function(x) {
    var y = this.glob[x.str];
    if (y === undefined)
      this.error("The variable " + x.str + " is unbound.");
    else
      return y;
  };

  Shenvm.prototype.set = function(x, y) {
    if (!(x instanceof this.Sym))
      this.error("The value " + x + " is not a symbol");
    return (this.glob[x.str] = y);
  };

  Shenvm.prototype.vector = function(n) {
    var r = new Array(n + 1);
    r[0] = n;
    for (var i = 1; i <= n; ++i)
      r[i] = this.fail_obj;
    return r;
  };

  Shenvm.prototype.esc = function(x) {
    var ret = "";
    for (var i = 0; i < x.length; ++i)
      switch (x[i]) {
        case '"': ret += '\\"'; break;
        default: ret += x[i]; break;
      }
    return ret;
  };

  Shenvm.prototype.str = function(x) {
    switch (typeof(x)) {
      case "string": return "\"" + this.esc(x) + "\"";
      case "number":
      case "boolean": return String(x);
      case "function": return "#<jsfunc " + x.name + ">";
      case "object":
        if (x === this.fail_obj)
          return "...";
        if (x instanceof this.Sym)
          return x.str;
        if (x instanceof this.Func) {
          if (!x.vars.length && x.name)
            return x.name;
          var n = (x.name) ? (" " + x.name) : " [nil]";
          return (!x.vars.length) ? "#<func" + n + ">" : "#<closure" + n + ">";
        }
    }
    var err = " is not an atom in Shen; str cannot print it to a string."
    return this.error(String(x) + err);
  };

  Shenvm.prototype.intern = function(x) {
    switch (x) {
    case "true": return true;
    case "false": return false;
    default: return new this.Sym(x);
    }
  };

  Shenvm.prototype.tlstr = function(x) {
    if (x === "")
      return new this.Sym("shen.eos");
    return x.substring(1, x.length);
  };

  Shenvm.prototype.str_from_n = function(x) {
    return String.fromCharCode(x);
  };

  Shenvm.prototype.n_from_str = function(x) {
    return x.charCodeAt(0);
  };

  Shenvm.prototype.wipe_stack = function(start) {
    var r = this.reg;
    var n = this.sp_top;
    for (var i = this.sp + start; i < n; ++i)
      delete r[i];
  };

  Shenvm.prototype.error = function(s) {
    throw new Error(s);
    return this.fail_obj;
  };

  Shenvm.prototype.error_to_string = function(s) {
    var stack = s.stack;
    var show = (stack !== undefined);
    show &= this.is_true(this.glob["js.show-error-stack"]);
    return (show) ? ("" + s + " " + stack) : ("" + s);
  };

  Shenvm.prototype.bootstrap_eval_str = function(s) {
    this._bs_eval_buf += s + "\n";
  };

  Shenvm.prototype.write_string = function(s, stream) {
    var w = this.write_byte;
    for (var i = 0; i < s.length; ++i)
      w(s.charCodeAt(i), stream);
    return s;
  };

  Shenvm.prototype.defun_x = function(name, arity, fn) {
    var fobj = new this.Func(name, arity, fn);
    this.fns[name] = fobj;
    return fobj;
  };

  Shenvm.prototype.defun = function() {
    function dashify(s) {
      return s.replace(/_/g, "-");
    }
    var arg0 = arguments[0], arg1 = arguments[1];
    switch (typeof(arg0)) {
    case "function":
      var fn = arg0;
      var name = dashify(fn.name);
      break;
    case "string":
      var name = arguments[0];
      var fn = arguments[1];
      break;
    default:
      return this.error("defun: wrong arguments");
    }
    var arity = fn.length;
    var fobj = new this.Func(name, arity, function f(vm) {
      var x = vm.fn_entry(f, arity, name);
      if (x !== vm.fail_obj) return x;
      var sp = vm.sp;
      var args = vm.reg.slice(sp, sp + arity).reverse();
      return vm.fn_return(fn.apply(vm, args), vm.next);
    });
    this.fns[name] = fobj;
    return fobj;
  };

  Shenvm.prototype.partial_func = function(name, arity, fn) {
    var vars = this.reg.slice(this.sp, this.sp + this.nargs);
    return new this.Func(name, arity, fn, vars);
  };

  Shenvm.prototype.defun_x("klvm.mk-closure", -1, function mk_closure(vm) {
    var r = vm.reg, sp = vm.sp, n = vm.nargs;
    var fn = r[sp + n - 1];
    if (fn instanceof vm.Func)
      fn = fn.fn;
    vm.ret = new vm.Func(null, n - 1, fn, r.slice(sp, sp + n - 1));
    return vm.next;
  });

  Shenvm.prototype.eval = function(s) {
    this.ret = false;
    var vm = this;
    var toplevel_next = this.next;
    if (this.dump_eval_enabled)
      print("EVAL:\n" + s + "\n");
    this.wipe_stack(0);
    eval(s);
    return toplevel_next;
  };

  Shenvm.prototype._bs_obj = function(x) {
    switch (typeof(x)) {
      case "string": return "\"" + this.esc(x) + "\"";
      case "number":
      case "boolean": return String(x);
      case "function": return x.name;
      case "object":
        if (x === this.fail_obj)
          return "this.fail_obj";
        if (x instanceof Array) {
          if (x.length <= 0)
            return "[]"
          var repr = this._bs_obj.bind(this);
          return "[" + x.map(repr).join(", ") + "]";
        }
        var types = {
          "Shen.Tag": this.Tag,
          "Shen.Cons": this.Cons,
          "Shen.Func": this.Func,
          "Shen.Sym": this.Sym,
          "Shen.Stream": this.Stream,
        };
        for (var t in types) {
          if (x instanceof types[t]) {
            var obj = {type: t};
            for (var key in x)
              obj[key] = this._bs_obj(x[key]);
            return JSON.stringify(obj);
          }
        }
        return "XXXX";
    }
  };

  Shenvm.prototype._bs_var = function(name, obj) {
    this.io.puts("Shen." + name + " = (function() {\n  return {\n");
    for (var key in obj) {
      var repr = this._bs_obj(obj[key]);
      this.io.puts('    "' + this.esc(key) + '": ' + repr + ",\n");
    }
    this.io.puts("  };\n})();\n");
  };

  Shenvm.prototype.bootstrap = function() {
    this.io.puts(this._bs_var("glob", this.glob));
    this.io.puts(this._bs_eval_buf);
  };

// UTILS {
  Shenvm.prototype.xstr_arr = function(x, nmax) {
    var xstr = this.xstr.bind(this);
    if (nmax)
      return x.slice(0, nmax).join(" ") + " ...";
    return x.map(xstr).join(" ");
  };

  Shenvm.prototype.xstr_cons = function(x, nmax) {
    var lst = [], i = 0;
    do {
      lst.push(this.xstr(x.head, nmax));
      x = x.tail;
      i++;
    } while (x instanceof this.Cons && (!nmax || i < nmax));
    var str = lst.join(" ");
    if (nmax) {
      str += " …";
    } else if (!this.is_empty(x))
      str += " | " + this.xstr(x, nmax);
    return "[" + str + "]";
  };

  Shenvm.prototype.xstr = function(x, nmax) {
    switch (typeof(x)) {
      case "string": return '"' + this.esc(x) + '"';
      case "boolean": case "number": return String(x);
      case "function": 
        if (x.name)
          return "#<jsfunc " + x.name + ">";
        return "#<jsfunc>";
    }
    if (x instanceof this.Sym)
      return x.str;
    if (x instanceof this.Cons)
      return this.xstr_cons(x, nmax);
    if (x instanceof this.Func)
      return "#<func " + x.name + " <" + this.xstr_arr(x.vars) + ">>";
    if (this.is_empty(x))
      return "[]";
    if (this.is_vector(x))
      return "<" + this.xstr_arr(x, nmax) + ">";
    if (x instanceof Array)
      return "<<" + this.xstr_arr(x, nmax) + ">>";
    return String(x);
  };

  Shenvm.prototype.list = function(x) {
    var ret = [];
    for (var i = x.length - 1; i >= 0; --i)
      ret = new this.Cons(x[i], ret);
    return ret;
  };

  function dbg_printer(vm) {
    try {return vm.puts;} catch (e) {}
    try {return putstr;} catch (e) {}
    try {return write;} catch (e) {}
    return this.error("No printer");
  };

  Shenvm.prototype.dump_regs = function(start, n) {
    var pr = dbg_printer(this);
    var r = this.reg, io = this.io;
    var n = n || 20;
    var start = (start === undefined) ? this.sp : start;
    for (var i = start, j = start; i < r.length; ++i) {
      if (r[i] !== undefined) {
        if (j + 1 == i - 1)
          pr("    " + (i - 1) + ": nil\n");
        else if (j + 1 < i)
          pr("    " + (j + 1) + ".." + (i - 1) + ": nil\n");
        var x = this.dbg_str_prefixed(this.xstr(r[i], n), "      ");
        pr("    " + i + ": " + x + "\n");
        j = i;
      }
    }
  };

  Shenvm.prototype.dbg_str_prefixed = function(x, prefix) {
    function pre(x) {return prefix + x;}
    var lines = String(x).split("\n");
    if (lines.length < 2)
      return x;
    return lines[0] + "\n" + lines.slice(1).map(pre).join("\n");
  };

  Shenvm.prototype.dump_state = function(extra) {
    var pr = this.dbg_printer();
    var n = 20;
    pr("# STEP ################\n");
    for (var x in extra)
      pr("  " + x + ": " + this.xstr(extra[x]) + "\n");
    pr("  next: " + this.xstr(this.next) + "\n");
    pr("  ret: " + this.xstr(this.ret, n) + "\n");
    pr("  nargs: " + this.nargs + "\n");
    pr("  sp: " + this.sp + "\n");
    pr("  regs:\n");
    this.dump_regs(this.sp, n);
    pr("\n\n");
  };

  Shenvm.prototype.inspect_obj = function(obj) {
    var pr = this.dbg_printer();
    pr("INSPECT " + obj + "\n");
    pr("  type: " + this.typeof(obj) + "\n");
    for (var key in obj)
      pr("  ." + key + ": " + obj[key] + "\n");
    pr("\n");
  };

  Shenvm.prototype.typeof = function(obj) {
    switch(typeof(obj)) {
      case "string": return "string";
      case "boolean": return "boolean";
      case "number": return "number";
      case "function": return "jsfunction";
      case "object":
        if (obj === this.fail_obj)
          return "fail";
        if (obj === this.interrupt_obj)
          return "interrupt";
        if (obj instanceof this.Sym)
          return "symbol";
        if (obj instanceof this.Cons)
          return "cons";
        if (obj instanceof this.Func)
          return "function";
        if (obj instanceof this.Stream)
          return "stream";
        if (obj instanceof Array)
          return "array";
    }
    return "other";
  };
  // } UTILS

  // IO {
  Shenvm.prototype.Utf8_reader = function(str) {
    this.str = str || "";
    this.strpos = 0;
    this.bytes = Array(6);
    this.bytepos = 0;
    this.nbytes = 0;
    this.append = function(data) {
      this.str += data;
    };
    this.read_byte = function() {
      if (this.bytepos < this.nbytes)
        return this.bytes[this.bytepos++];
      if (this.strpos >= this.str.length)
        return -1;
      var c = this.str.charCodeAt(this.strpos++);
      this.bytepos = 0;
      this.nbytes = 0;
      if (c <= 0x7f)
        return c;
      if (c <= 0x7ff) {
        var n = 1;
        var c0 = (c >> 6) | 192;
      } else if (c <= 0xffff) {
        var n = 2;
        var c0 = (c >> 12) | 224;
      } else if (c <= 0x1fffff) {
        var n = 3;
        var c0 = (c >> 18) | 240;
      } else if (c <= 0x3ffffff) {
        var n = 4;
        var c0 = (c >> 24) | 248;
      } else if (c <= 0x7fffffff) {
        var n = 5;
        var c0 = (c >> 30) | 252;
      } else
        throw new Error("Character " + c + " cannot be coded to UTF-8");
      this.nbytes = n;
      var shift = (n - 1) * 6;
      for (var i = 0; i < n; ++i, shift -= 6)
        this.bytes[i] = ((c >> shift) & 63) | 128;
      return c0;
    };
  };

  Shenvm.prototype.Utf8_writer = function(char_fn) {
    this.nbytes = 0;
    this.char = 0;
    this.bytespos = 0;
    this.write_byte = function(byte) {
      if (!(byte & 0x80)) {
        char_fn(byte);
        this.bytespos = 0;
      } else if ((byte & 224) == 192) {
        this.char = byte & 31;
        this.nbytes = 2;
        this.bytespos = 1;
      } else if ((byte & 240) == 224) {
        this.char = byte & 15;
        this.nbytes = 3;
        this.bytespos = 1;
      } else if ((byte & 248) == 240) {
        this.char = byte & 7;
        this.nbytes = 4;
        this.bytespos = 1;
      } else if ((byte & 252) == 248) {
        this.char = byte & 3;
        this.nbytes = 5;
        this.bytespos = 1;
      } else if ((byte & 254) == 252) {
        this.char = byte & 1;
        this.nbytes = 6;
        this.bytespos = 1;
      } else {
        this.char = (this.char << 6) | (byte & 0x7f);
        this.bytespos++;
        if (this.bytespos >= this.nbytes) {
          char_fn(this.char);
          this.bytespos = 0;
          this.nbytes = 0;
        }
      }
    }
  };

  Shenvm.prototype.str_from_utf8 = function(s) {
    var ret = "";
    function emit(x) {ret += String.fromCharCode(x)}
    var w = new this.Utf8_writer(emit);
    var wbyte = w.write_byte, n = s.length;
    for (var i = 0; i < n; ++i)
      wbyte(s[i]);
    return ret;
  };

  Shenvm.prototype.utf8_from_str = function(s) {
    var c, r = new this.Utf8_reader(s), bytes = [];
    while ((c = r.read_byte()) >= 0)
      bytes.push(c);
    return bytes;
  };

  Shenvm.prototype.buf_stream = function(buf) {
    var arr = new Uint8Array(buf);
    function r() {
      var buf = this.buf;
      if (this.pos >= buf.length)
        return -1;
      return buf[this.pos++];
    }
    var stream = new this.Stream('r', r, function() {});
    stream.pos = 0;
    stream.buf = arr;
    return stream;
  };

  Shenvm.prototype.console_io = function(vm) {
    var io = {};

    function file_reader() {
      try {
        return readbuffer;
      } catch(e) {
        read;
        return function(name) {return read(name, "binary")};
      }
    }

    io.open = function open(vm, name, dir) {
      var filename = vm.glob["*home-directory*"] + name;
      if ($HOME)
        var filename = filename.replace(/^~/, $HOME);
      if (dir.str === "in") {
        var buf = file_reader()(filename);
        if (buf instanceof ArrayBuffer)
          return vm.buf_stream(buf);
        else if (typeof(buf) === "string") {
          var strbuf = new vm.Utf8_reader(buf);
          return new vm.Stream("r",
                               function(vm) {return strbuf.read_byte();},
                               function(vm){});
        } else
          return vm.error("Unsupported file read result");
      } else if (dir.str === "out")
        return vm.error("Writing files is not supported in cli interpreter");
      return vm.error("Unsupported 'open' flags");
    };

    var out_buf = "";

    io.gets = readline;
    io.puts = function console_puts(x) {
      out_buf += x;
      var pos = out_buf.lastIndexOf("\n");
      if (pos >= 0) {
        print(out_buf.substring(0, pos));
        out_buf = out_buf.substring(pos + 1);
      }
    };

    var writer = new vm.Utf8_writer(function(char) {
      io.puts(String.fromCharCode(char));
    });
    var stdout = new vm.Stream("w", function(vm, byte) {
                                      writer.write_byte(byte);
                                    });
    var stdin = new vm.Stream("r", null, function(vm) {quit();});
    strbuf = new vm.Utf8_reader();
    stdin.read_byte = function (vm) {
      var x = strbuf.read_byte();
      if (x >= 0)
        return x;
      var str = this.io.gets();
      if (str == null) {
        vm.quit();
        return -1;
      }
      strbuf = new vm.Utf8_reader(str + "\n");
      return this.read_byte(vm);
    };
    vm.glob["*stinput*"] = stdin;
    vm.glob["*stoutput*"] = stdout;
    return io;
  };

  // } IO

  Shenvm.prototype.nop = function(vm) {
    vm.wipe_stack(0);
    return vm.next;
  };

  Shenvm.prototype.init = function(opts) {
    this.io = opts.io(this);
    if (!this.io)
      return this.error("Shen: IO is not set");
    var keys = ["gets", "puts", "open"];
    for (var i = 0; i < keys.length; ++i)
      if (!this.io[keys[i]])
        throw new Error("Shen: IO has no method " + keys[i]);
    if (opts.bootstrap) {
      this.eval_str = this.bootstrap_eval_str;
    }
    switch (opts.run_mode) {
    case "interval": this.run = this.run_interval; break;
    default: this.run = this.run_loop;
    }
    if (opts.repl)
      this.call("shen.shen", []);
  };

  Shenvm.prototype.console_repl = function() {
    Shen.init({repl: true, io: Shen.console_io});
  };

  var sh = new Shenvm();

  sh.eval_str = sh.eval;
  sh.defun_x("shen.process-datatype", 2, sh.nop);
  sh.defun_x("compile", 3, sh.nop);
  sh.defun_x("declare", 2, sh.nop);
  sh.defun_x("adjoin", 2, sh.nop);

  sh.defun_x("js.eval", 1, function js_eval(vm) {
    return vm.eval_str(vm.reg[vm.sp]);
  });

  sh.defun_x("js.typeof", 1, function js_typeof(vm) {
    vm.ret = vm.Sym(vm.typeof(vm.reg[vm.sp]));
    return vm.next;
  });

  sh.defun(function get_time(type) {
    switch (type.str) {
    case "run":
    case "unix": return Math.floor(Date.now() / 1000);
    case "run/ms":
    case "unix/ms": return Date.now();
    default: return this.error("get-time does not understand the parameter "
                               + type.str);
    }
  });

  sh.defun("js.gc_stack", function gc_stack() {
    vm.wipe_stack(0);
    return true;
  });

  return sh;
})();

try {module.exports = Shen;} catch (e) {}